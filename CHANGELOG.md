# Changelog

All notable changes to ChainTap will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-01-14

### Added

#### Core Features
- **Zero-config blockchain event indexing** - Index EVM chain events with minimal setup
- **Automatic ABI fetching** - Retrieves contract ABIs from Etherscan V2 API with local caching
- **Multi-contract support** - Index multiple contracts in a single configuration file
- **Multiple event types** - Track different event types (Transfer, Approval, etc.) from same contract
- **SQLite storage** - Single unified events table with proper indexing
- **Multi-provider failover** - Automatic RPC provider switching with health tracking
- **Dynamic block range adjustment** - Automatically adapts to RPC provider limits (500→10 blocks)
- **Resumable indexing** - Continues from last synced block after interruption
- **Sync state tracking** - Per-contract sync progress stored atomically

#### CLI Commands
- `chaintap watch` - Real-time event indexing from latest blocks
- `chaintap backfill` - Historical data indexing for specific block ranges
- `chaintap status` - Show sync progress and statistics for all contracts

#### Supported Chains
- Ethereum Mainnet
- Polygon
- Arbitrum
- Optimism
- Base
- BSC (Binance Smart Chain)

#### Configuration
- YAML configuration with environment variable interpolation
- Optional fields with sensible defaults
- Zod-based runtime validation
- Manual ABI support for unverified contracts

#### Developer Features
- TypeScript with strict mode
- ESM module support
- Comprehensive unit test suite (155 tests, 80%+ coverage)
- Structured logging with Pino
- Programmatic API for library usage
- Event decoding with ethers.js v6

#### Storage Schema
```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_address TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  block_timestamp INTEGER NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  event_data TEXT NOT NULL,  -- JSON
  indexed_at INTEGER NOT NULL,
  UNIQUE(transaction_hash, log_index)
);
```

#### Indexes
- `idx_events_contract_block` - Query events by contract and block range
- `idx_events_contract_event` - Filter by contract and event type
- `idx_events_block` - Sort by block number

### Performance
- Historical sync: 10,000+ blocks/minute (with paid RPC tiers)
- Live indexing: <30 second latency
- Memory usage: <256MB for typical workloads
- SQLite throughput: 5,000+ events/second with batch inserts

### Testing
- ✅ All 155 unit tests passing
- ✅ Live mainnet testing with Ethereum
- ✅ Automatic ABI fetching verified
- ✅ Multi-contract indexing validated
- ✅ Provider failover tested
- ✅ Dynamic pagination working (Alchemy 10-block limit)

### Documentation
- Comprehensive README with quick start guide
- Example configuration file (chaintap.example.yaml)
- CLAUDE.md for AI-assisted development
- CONTRIBUTING.md with development guidelines
- MIT License

### Known Limitations
- Alchemy free tier: 10-block limit per `eth_getLogs` request
- Infura free tier: Very restrictive rate limits
- Watch mode: Implemented but requires extended live testing

### Fixed Issues
- ✅ Updated to Etherscan V2 API (V1 deprecated)
- ✅ Added `chainid` parameter to Etherscan API calls
- ✅ Fixed ETHERSCAN_API_KEY environment variable passing
- ✅ Dynamic block range reduction working correctly

[Unreleased]: https://github.com/protereus/chaintap/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/protereus/chaintap/releases/tag/v0.1.0
