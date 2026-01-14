import { Config, ContractConfig, Chain } from '../cli/config.js';
import { StorageAdapter } from '../storage/adapter.js';
import { ProviderPool } from '../providers/provider-pool.js';
import { Logger } from '../utils/logger.js';
import { ABIFetcher } from '../abi/fetcher.js';
import { EventDecoder } from '../abi/decoder.js';
import { EventFetcher } from './event-fetcher.js';
import { RPCError } from '../utils/errors.js';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Chain ID mapping for supported chains
 */
const CHAIN_IDS: Record<Chain, number> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  bsc: 56,
};

/**
 * Main indexer orchestrator that coordinates event fetching, decoding, and storage
 */
export class Indexer {
  private running = false;
  private watchTasks: Map<string, NodeJS.Timeout> = new Map();
  private abiFetcher: ABIFetcher;

  constructor(
    private config: Config,
    private storage: StorageAdapter,
    private providerPool: ProviderPool,
    private logger: Logger
  ) {
    // Initialize ABI fetcher with cache directory
    const cacheDir = path.join(os.homedir(), '.chaintap', 'abi-cache');
    this.abiFetcher = new ABIFetcher(cacheDir, process.env.ETHERSCAN_API_KEY);
  }

  /**
   * Start watch mode for all contracts in config
   */
  async startWatch(): Promise<void> {
    if (this.running) {
      throw new Error('Indexer is already running');
    }

    this.running = true;
    this.logger.info('Starting watch mode for all contracts');

    // Start watching all contracts
    const watchPromises = this.config.contracts.map(contract =>
      this.watchContract(contract)
    );

    await Promise.all(watchPromises);
  }

  /**
   * Watch a single contract for new blocks
   */
  async watchContract(contractConfig: ContractConfig): Promise<void> {
    const contractAddress = contractConfig.address.toLowerCase();

    this.logger.info({
      contract: contractConfig.name || contractAddress,
      address: contractAddress,
      events: contractConfig.events,
      chain: this.config.chain,
    }, 'Starting to watch contract');

    // Get or initialize from_block
    let currentBlock: number;
    if (contractConfig.from_block === null) {
      // If from_block is null, get current block number
      const provider = await this.providerPool.getProvider();
      try {
        currentBlock = await provider.provider.getBlockNumber();
        await this.providerPool.reportSuccess(provider.id);
        this.logger.info({
          contract: contractConfig.name || contractAddress,
          fromBlock: currentBlock,
        }, 'Using current block as starting point');
      } catch (error) {
        await this.providerPool.reportFailure(provider.id, error as Error);
        throw new RPCError(
          `Failed to get current block number: ${error instanceof Error ? error.message : String(error)}`,
          provider.id
        );
      }
    } else {
      currentBlock = contractConfig.from_block;
      // Check if we have a last synced block in storage
      const lastSyncedBlock = await this.storage.getLastSyncedBlock(contractAddress);
      if (lastSyncedBlock !== null && lastSyncedBlock >= currentBlock) {
        currentBlock = lastSyncedBlock + 1;
        this.logger.info({
          contract: contractConfig.name || contractAddress,
          resumingFromBlock: currentBlock,
        }, 'Resuming from last synced block');
      }
    }

    // Start polling loop
    const pollLoop = async () => {
      if (!this.running) {
        return;
      }

      try {
        const provider = await this.providerPool.getProvider();

        try {
          // Get latest block number
          const latestBlock = await provider.provider.getBlockNumber();
          await this.providerPool.reportSuccess(provider.id);

          // Calculate target block with confirmations
          const targetBlock = latestBlock - this.config.options.confirmations;

          if (currentBlock <= targetBlock) {
            this.logger.debug({
              contract: contractConfig.name || contractAddress,
              fromBlock: currentBlock,
              toBlock: targetBlock,
            }, 'Indexing block range');

            // Index the block range
            await this.indexBlocks(contractConfig, currentBlock, targetBlock);

            // Update current block for next iteration
            currentBlock = targetBlock + 1;
          } else {
            this.logger.debug({
              contract: contractConfig.name || contractAddress,
              currentBlock,
              latestBlock,
              confirmations: this.config.options.confirmations,
            }, 'Waiting for new blocks');
          }
        } catch (error) {
          await this.providerPool.reportFailure(provider.id, error as Error);
          this.logger.error({
            error: error instanceof Error ? error.message : String(error),
            providerId: provider.id,
            contract: contractConfig.name || contractAddress,
          }, 'Error during polling');
        }
      } catch (error) {
        this.logger.error({
          error: error instanceof Error ? error.message : String(error),
          contract: contractConfig.name || contractAddress,
        }, 'Error getting provider');
      }

      // Schedule next poll
      if (this.running) {
        const timeout = setTimeout(pollLoop, this.config.options.poll_interval);
        this.watchTasks.set(contractAddress, timeout);
      }
    };

    // Start the polling loop
    await pollLoop();
  }

  /**
   * Index events for a specific block range
   */
  async indexBlocks(
    contractConfig: ContractConfig,
    fromBlock: number,
    toBlock: number
  ): Promise<void> {
    const chainId = this.getChainId(this.config.chain);
    const contractAddress = contractConfig.address.toLowerCase();

    this.logger.info({
      contract: contractConfig.name || contractAddress,
      fromBlock,
      toBlock,
      blockCount: toBlock - fromBlock + 1,
    }, 'Indexing blocks');

    // Get provider
    const provider = await this.providerPool.getProvider();

    try {
      // Get ABI and create decoder
      const iface = await this.abiFetcher.getABI(
        contractAddress,
        chainId,
        contractConfig.abi
      );
      const decoder = new EventDecoder(iface);

      // Create event fetcher
      const fetcher = new EventFetcher(
        provider.provider,
        provider.id,
        decoder,
        this.logger,
        this.config.options.batch_size
      );

      // Fetch events
      const events = await fetcher.fetchEvents(
        contractAddress,
        contractConfig.events,
        fromBlock,
        toBlock
      );

      await this.providerPool.reportSuccess(provider.id);

      // Store events and update sync state
      await this.storage.updateSyncStateAndInsertEvents(
        contractAddress,
        chainId,
        toBlock,
        events
      );

      this.logger.info({
        contract: contractConfig.name || contractAddress,
        fromBlock,
        toBlock,
        eventCount: events.length,
      }, 'Indexed blocks successfully');

    } catch (error) {
      await this.providerPool.reportFailure(provider.id, error as Error);

      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        contract: contractConfig.name || contractAddress,
        fromBlock,
        toBlock,
        providerId: provider.id,
      }, 'Failed to index blocks');

      throw new RPCError(
        `Failed to index blocks: ${error instanceof Error ? error.message : String(error)}`,
        provider.id
      );
    }
  }

  /**
   * Stop the indexer and clean up resources
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping indexer');
    this.running = false;

    // Clear all watch task timeouts
    for (const [contractAddress, timeout] of this.watchTasks.entries()) {
      clearTimeout(timeout);
      this.logger.debug({ contractAddress }, 'Stopped watching contract');
    }

    this.watchTasks.clear();
    this.logger.info('Indexer stopped');
  }

  /**
   * Get chain ID from chain name
   */
  private getChainId(chain: Chain): number {
    return CHAIN_IDS[chain];
  }
}
