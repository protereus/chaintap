import { Config, ContractConfig, Chain } from '../cli/config.js';
import { StorageAdapter } from '../storage/adapter.js';
import { ProviderPool } from '../providers/provider-pool.js';
import { Logger } from '../utils/logger.js';
import { ABIFetcher } from '../abi/fetcher.js';
import { EventDecoder } from '../abi/decoder.js';
import { EventFetcher } from './event-fetcher.js';
import { RPCError } from '../utils/errors.js';
import { CHAIN_DEFAULTS } from '../config/chains.js';
import { CheckpointManager } from '../utils/checkpoint.js';
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
  private checkpointManager: CheckpointManager;

  constructor(
    private config: Config,
    private storage: StorageAdapter,
    private providerPool: ProviderPool,
    private logger: Logger
  ) {
    // Initialize ABI fetcher with cache directory
    const cacheDir = path.join(os.homedir(), '.chaintap', 'abi-cache');
    this.abiFetcher = new ABIFetcher(cacheDir, process.env.ETHERSCAN_API_KEY);

    // Initialize checkpoint manager
    const baseDir = path.join(os.homedir(), '.chaintap');
    this.checkpointManager = new CheckpointManager(baseDir, this.logger);

    // Apply chain-specific defaults to config
    this.applyChainDefaults();
  }

  /**
   * Apply chain-specific defaults to configuration
   */
  private applyChainDefaults(): void {
    const defaults = CHAIN_DEFAULTS[this.config.chain];

    // Apply defaults only if user hasn't specified values
    if (this.config.options.batch_size === 2000) {
      // 2000 is the schema default, so override with chain-specific default
      this.config.options.batch_size = defaults.batch_size;
    }

    if (this.config.options.confirmations === 12) {
      // 12 is the schema default, so override with chain-specific default
      this.config.options.confirmations = defaults.confirmations;
    }

    this.logger.info({
      chain: this.config.chain,
      batch_size: this.config.options.batch_size,
      confirmations: this.config.options.confirmations,
    }, 'Applied chain-specific defaults');
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
    toBlock: number,
    options: { resume?: boolean } = {}
  ): Promise<void> {
    const chainId = this.getChainId(this.config.chain);
    const contractAddress = contractConfig.address.toLowerCase();

    // Check for existing checkpoint if resume is enabled (default: true)
    const shouldResume = options.resume !== false;
    let actualFromBlock = fromBlock;
    let totalEvents = 0;

    if (shouldResume) {
      const checkpoint = await this.checkpointManager.load(chainId, contractAddress);
      if (checkpoint && checkpoint.targetBlock === toBlock && checkpoint.status === 'in_progress') {
        // Resume from checkpoint
        actualFromBlock = checkpoint.lastBlock + 1;
        totalEvents = checkpoint.totalEvents;

        this.logger.info({
          contract: contractConfig.name || contractAddress,
          resumeFromBlock: actualFromBlock,
          checkpointBlock: checkpoint.lastBlock,
          eventsIndexed: totalEvents,
        }, 'Resuming from checkpoint');
      } else if (checkpoint) {
        this.logger.debug({
          contract: contractConfig.name || contractAddress,
          checkpoint,
        }, 'Checkpoint exists but not applicable (different range or already completed)');
      }
    }

    this.logger.info({
      contract: contractConfig.name || contractAddress,
      fromBlock: actualFromBlock,
      toBlock,
      blockCount: toBlock - actualFromBlock + 1,
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

      // Use streaming API to process events in batches
      let currentBlock = actualFromBlock;
      let lastCheckpointTime = Date.now();
      const CHECKPOINT_INTERVAL_BLOCKS = 10000;
      const CHECKPOINT_INTERVAL_TIME = 60000; // 60 seconds

      for await (const eventBatch of fetcher.fetchEventsStream(
        contractAddress,
        contractConfig.events,
        actualFromBlock,
        toBlock
      )) {
        // Use batched insert
        await (this.storage as any).insertEventsBatched(
          contractAddress,
          chainId,
          eventBatch
        );

        totalEvents += eventBatch.length;

        // Update current block from batch (use the highest block number in batch)
        if (eventBatch.length > 0) {
          currentBlock = Math.max(...eventBatch.map(e => e.blockNumber));
        }

        // Log memory usage per batch
        const memUsage = process.memoryUsage();
        this.logger.debug({
          contract: contractConfig.name || contractAddress,
          batchSize: eventBatch.length,
          totalEvents,
          currentBlock,
          heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        }, 'Batch processed');

        // Save checkpoint periodically (every 10K blocks or 60 seconds)
        const now = Date.now();
        const blocksSinceStart = currentBlock - actualFromBlock;
        const timeSinceCheckpoint = now - lastCheckpointTime;

        if (
          shouldResume &&
          (blocksSinceStart > 0 && blocksSinceStart % CHECKPOINT_INTERVAL_BLOCKS === 0 ||
           timeSinceCheckpoint >= CHECKPOINT_INTERVAL_TIME)
        ) {
          await this.checkpointManager.save({
            version: '0.2.0',
            contract: contractAddress,
            chainId,
            lastBlock: currentBlock,
            timestamp: new Date().toISOString(),
            totalEvents,
            status: 'in_progress',
            startBlock: fromBlock,
            targetBlock: toBlock,
          });
          lastCheckpointTime = now;
        }
      }

      await this.providerPool.reportSuccess(provider.id);

      // Final flush of pending events
      if (typeof (this.storage as any).flushPending === 'function') {
        await (this.storage as any).flushPending(contractAddress, chainId);
      }

      // Clear checkpoint on successful completion
      if (shouldResume) {
        await this.checkpointManager.clear(chainId, contractAddress);
      }

      this.logger.info({
        contract: contractConfig.name || contractAddress,
        fromBlock: actualFromBlock,
        toBlock,
        eventCount: totalEvents,
      }, 'Indexed blocks successfully');

    } catch (error) {
      await this.providerPool.reportFailure(provider.id, error as Error);

      // Save checkpoint on error for crash recovery
      if (shouldResume && totalEvents > 0) {
        try {
          await this.checkpointManager.save({
            version: '0.2.0',
            contract: contractAddress,
            chainId,
            lastBlock: actualFromBlock, // Use last successfully indexed block
            timestamp: new Date().toISOString(),
            totalEvents,
            status: 'in_progress',
            startBlock: fromBlock,
            targetBlock: toBlock,
          });
          this.logger.info({
            contract: contractConfig.name || contractAddress,
            lastBlock: actualFromBlock,
          }, 'Checkpoint saved after error for recovery');
        } catch (checkpointError) {
          this.logger.warn({
            error: checkpointError instanceof Error ? checkpointError.message : String(checkpointError),
          }, 'Failed to save checkpoint after error');
        }
      }

      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        contract: contractConfig.name || contractAddress,
        fromBlock: actualFromBlock,
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
