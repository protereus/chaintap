import { Command } from 'commander';
import { loadConfigFile } from '../config.js';
import { SQLiteAdapter } from '../../storage/sqlite.js';
import { ProviderPool } from '../../providers/provider-pool.js';
import { Indexer } from '../../core/indexer.js';
import { createLogger } from '../../utils/logger.js';
import { ConfigError, RPCError, StorageError } from '../../utils/errors.js';

/**
 * Create the backfill command
 */
export function createBackfillCommand(): Command {
  const command = new Command('backfill');

  command
    .description('Backfill historical events for configured contracts')
    .requiredOption('--from-block <number>', 'Starting block number', parseInt)
    .requiredOption('--to-block <number|latest>', 'Ending block number or "latest"')
    .option('-c, --config <path>', 'Path to configuration file', './chaintap.yaml')
    .option('-v, --verbose', 'Enable verbose logging', false)
    .action(async (options) => {
      const logger = createLogger(options.verbose);
      let storage: SQLiteAdapter | null = null;

      try {
        // Load configuration
        logger.info({ configPath: options.config }, 'Loading configuration');
        const config = loadConfigFile(options.config);

        // Initialize storage
        logger.info({ dbPath: config.database.path }, 'Initializing database');
        storage = new SQLiteAdapter(config.database.path);
        await storage.init();

        // Initialize provider pool
        logger.info(
          { providerCount: config.providers.length },
          'Initializing provider pool'
        );
        const providerPool = new ProviderPool(config.providers, {
          failureThreshold: 3,
          cooldownPeriod: 30000,
        });

        // Parse from block
        const fromBlock = options.fromBlock;
        if (isNaN(fromBlock) || fromBlock < 0) {
          throw new ConfigError('--from-block must be a non-negative integer');
        }

        // Parse to block
        let toBlock: number;
        if (options.toBlock === 'latest') {
          const provider = await providerPool.getProvider();
          try {
            toBlock = await provider.provider.getBlockNumber();
            await providerPool.reportSuccess(provider.id);
            logger.info({ toBlock }, 'Using latest block');
          } catch (error) {
            await providerPool.reportFailure(provider.id, error as Error);
            throw new RPCError(
              `Failed to get latest block number: ${error instanceof Error ? error.message : String(error)}`,
              provider.id
            );
          }
        } else {
          toBlock = parseInt(options.toBlock);
          if (isNaN(toBlock) || toBlock < 0) {
            throw new ConfigError('--to-block must be a non-negative integer or "latest"');
          }
        }

        // Validate block range
        if (fromBlock > toBlock) {
          throw new ConfigError('--from-block must be less than or equal to --to-block');
        }

        // Create indexer
        const indexer = new Indexer(config, storage, providerPool, logger);

        // Track progress
        const startTime = Date.now();
        let totalEvents = 0;
        let lastProgressUpdate = Date.now();

        logger.info({
          fromBlock,
          toBlock,
          blockRange: toBlock - fromBlock + 1,
          contracts: config.contracts.length,
        }, 'Starting backfill');

        // Backfill each contract
        for (const contractConfig of config.contracts) {
          const contractName = contractConfig.name || contractConfig.address;
          logger.info({ contract: contractName }, 'Backfilling contract');

          try {
            // Get initial event count
            const initialCount = await storage.queryEvents({
              contractAddress: contractConfig.address.toLowerCase(),
            });
            const initialEventCount = initialCount.length;

            // Index blocks for this contract
            await indexer.indexBlocks(contractConfig, fromBlock, toBlock);

            // Get final event count
            const finalCount = await storage.queryEvents({
              contractAddress: contractConfig.address.toLowerCase(),
            });
            const finalEventCount = finalCount.length;
            const newEvents = finalEventCount - initialEventCount;
            totalEvents += newEvents;

            logger.info({
              contract: contractName,
              newEvents,
              totalEvents: finalEventCount,
            }, 'Contract backfill complete');

            // Progress report every 5 seconds
            const now = Date.now();
            if (now - lastProgressUpdate >= 5000) {
              const elapsed = (now - startTime) / 1000;
              const blocksProcessed = toBlock - fromBlock + 1;
              const blocksPerSecond = blocksProcessed / elapsed;

              logger.info({
                elapsed: `${elapsed.toFixed(1)}s`,
                totalEvents,
                blocksPerSecond: blocksPerSecond.toFixed(2),
              }, 'Backfill progress');

              lastProgressUpdate = now;
            }

          } catch (error) {
            logger.error({
              contract: contractName,
              error: error instanceof Error ? error.message : String(error),
            }, 'Failed to backfill contract');
            throw error;
          }
        }

        // Final summary
        const duration = (Date.now() - startTime) / 1000;
        const blocksProcessed = toBlock - fromBlock + 1;

        logger.info({
          fromBlock,
          toBlock,
          blocksProcessed,
          totalEvents,
          duration: `${duration.toFixed(2)}s`,
          eventsPerSecond: (totalEvents / duration).toFixed(2),
          blocksPerSecond: (blocksProcessed / duration).toFixed(2),
        }, 'Backfill complete');

        // Close storage
        await storage.close();
        process.exit(0);

      } catch (error) {
        if (storage) {
          await storage.close();
        }

        if (error instanceof ConfigError) {
          logger.error({ error: error.message }, 'Configuration error');
          process.exit(1);
        } else if (error instanceof RPCError) {
          logger.error({
            error: error.message,
            providerId: error.providerId,
          }, 'RPC provider error');
          process.exit(2);
        } else if (error instanceof StorageError) {
          logger.error({ error: error.message }, 'Storage error');
          process.exit(3);
        } else {
          logger.error({
            error: error instanceof Error ? error.message : String(error),
          }, 'Unexpected error');
          process.exit(1);
        }
      }
    });

  return command;
}
