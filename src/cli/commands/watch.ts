import { Command } from 'commander';
import { loadConfigFile } from '../config.js';
import { SQLiteAdapter } from '../../storage/sqlite.js';
import { ProviderPool } from '../../providers/provider-pool.js';
import { Indexer } from '../../core/indexer.js';
import { createLogger } from '../../utils/logger.js';
import { ConfigError, RPCError, StorageError } from '../../utils/errors.js';

/**
 * Create the watch command
 */
export function createWatchCommand(): Command {
  const command = new Command('watch');

  command
    .description('Watch and index events from configured contracts in real-time')
    .option('-c, --config <path>', 'Path to configuration file', './chaintap.yaml')
    .option('-v, --verbose', 'Enable verbose logging', false)
    .action(async (options) => {
      const logger = createLogger(options.verbose);
      let storage: SQLiteAdapter | null = null;
      let indexer: Indexer | null = null;

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

        // Create indexer
        indexer = new Indexer(config, storage, providerPool, logger);

        // Setup graceful shutdown
        const shutdown = async (signal: string) => {
          logger.info({ signal }, 'Received shutdown signal');

          if (indexer) {
            await indexer.stop();
          }

          if (storage) {
            await storage.close();
          }

          logger.info('Shutdown complete');
          process.exit(0);
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));

        // Start watching
        await indexer.startWatch();

      } catch (error) {
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
