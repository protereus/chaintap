// Export core types
export * from './core/types.js';

// Export main indexer
export { Indexer } from './core/indexer.js';

// Export storage adapters
export { StorageAdapter, EventFilter } from './storage/adapter.js';
export { SQLiteAdapter } from './storage/sqlite.js';

// Export configuration
export {
  Config,
  ContractConfig,
  ProviderConfig,
  DatabaseConfig,
  OptionsConfig,
  Chain,
  parseConfig,
  loadConfigFile,
} from './cli/config.js';

// Export provider pool
export { ProviderPool, ProviderInfo, ProviderHealth } from './providers/provider-pool.js';

// Export ABI utilities
export { ABIFetcher } from './abi/fetcher.js';
export { EventDecoder } from './abi/decoder.js';

// Export event fetcher
export { EventFetcher } from './core/event-fetcher.js';

// Export logger
export { createLogger, Logger } from './utils/logger.js';

// Export errors
export {
  ChainTapError,
  ConfigError,
  RPCError,
  StorageError,
  ABIError,
  FileSystemError,
} from './utils/errors.js';
