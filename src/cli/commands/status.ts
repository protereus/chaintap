import { Command } from 'commander';
import { loadConfigFile } from '../config.js';
import { SQLiteAdapter } from '../../storage/sqlite.js';
import { createLogger } from '../../utils/logger.js';
import { ConfigError, StorageError } from '../../utils/errors.js';
import Database from 'better-sqlite3';

interface SyncState {
  contract_address: string;
  chain_id: number;
  last_block: number;
  last_sync: number;
  status: string;
}

/**
 * Chain ID to name mapping
 */
const CHAIN_NAMES: Record<number, string> = {
  1: 'ethereum',
  137: 'polygon',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  56: 'bsc',
};

/**
 * Create the status command
 */
export function createStatusCommand(): Command {
  const command = new Command('status');

  command
    .description('Show sync status for all configured contracts')
    .option('-c, --config <path>', 'Path to configuration file', './chaintap.yaml')
    .option('-v, --verbose', 'Enable verbose logging', false)
    .action(async (options) => {
      const logger = createLogger(options.verbose);
      let storage: SQLiteAdapter | null = null;

      try {
        // Load configuration
        logger.debug({ configPath: options.config }, 'Loading configuration');
        const config = loadConfigFile(options.config);

        // Initialize storage
        logger.debug({ dbPath: config.database.path }, 'Opening database');
        storage = new SQLiteAdapter(config.database.path);
        await storage.init();

        // Get raw database access for sync_state queries
        const db = new Database(config.database.path);

        console.log('\nChainTap Status Report');
        console.log('='.repeat(60));
        console.log(`Chain: ${config.chain}`);
        console.log(`Database: ${config.database.path}`);
        console.log('='.repeat(60));
        console.log('');

        // Get status for each contract
        for (const contractConfig of config.contracts) {
          const contractAddress = contractConfig.address.toLowerCase();
          const contractName = contractConfig.name || 'Unknown';

          console.log(`Contract: ${contractName} (${contractConfig.address})`);

          // Get sync state
          const syncStateStmt = db.prepare(`
            SELECT * FROM sync_state WHERE contract_address = ?
          `);
          const syncState = syncStateStmt.get(contractAddress) as SyncState | undefined;

          if (syncState) {
            const chainName = CHAIN_NAMES[syncState.chain_id] || `Unknown (${syncState.chain_id})`;
            console.log(`  Chain: ${chainName} (chain_id: ${syncState.chain_id})`);
            console.log(`  Events: ${contractConfig.events.join(', ')}`);
            console.log(`  Last synced block: ${syncState.last_block.toLocaleString()}`);

            // Get event count
            const countStmt = db.prepare(`
              SELECT COUNT(*) as count FROM events WHERE contract_address = ?
            `);
            const countResult = countStmt.get(contractAddress) as { count: number };
            console.log(`  Total events: ${countResult.count.toLocaleString()}`);

            // Format last sync time
            const lastSyncDate = new Date(syncState.last_sync * 1000);
            const now = new Date();
            const timeDiff = Math.floor((now.getTime() - lastSyncDate.getTime()) / 1000);

            let timeAgo: string;
            if (timeDiff < 60) {
              timeAgo = `${timeDiff} seconds ago`;
            } else if (timeDiff < 3600) {
              timeAgo = `${Math.floor(timeDiff / 60)} minutes ago`;
            } else if (timeDiff < 86400) {
              timeAgo = `${Math.floor(timeDiff / 3600)} hours ago`;
            } else {
              timeAgo = `${Math.floor(timeDiff / 86400)} days ago`;
            }

            console.log(`  Last sync: ${lastSyncDate.toISOString()} (${timeAgo})`);
            console.log(`  Status: ${syncState.status}`);
          } else {
            console.log(`  Chain: ${config.chain}`);
            console.log(`  Events: ${contractConfig.events.join(', ')}`);
            console.log(`  Status: not synced yet`);
          }

          console.log('');
        }

        // Close database
        db.close();
        await storage.close();

        process.exit(0);

      } catch (error) {
        if (storage) {
          await storage.close();
        }

        if (error instanceof ConfigError) {
          logger.error({ error: error.message }, 'Configuration error');
          console.error('\nError:', error.message);
          process.exit(1);
        } else if (error instanceof StorageError) {
          logger.error({ error: error.message }, 'Storage error');
          console.error('\nError:', error.message);
          process.exit(3);
        } else {
          logger.error({
            error: error instanceof Error ? error.message : String(error),
          }, 'Unexpected error');
          console.error('\nError:', error instanceof Error ? error.message : String(error));
          process.exit(1);
        }
      }
    });

  return command;
}
