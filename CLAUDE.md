# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChainTap is a zero-config blockchain event indexer that watches EVM chain events and writes them to SQLite/Postgres. It's designed as a lightweight alternative to The Graph - no GraphQL schemas, AssemblyScript mappings, or complex setup required.

**Target users**: Indie dApp developers, NFT projects, DeFi protocols needing basic analytics without The Graph's complexity.

## Development Commands

```bash
# Development
npm run dev -- watch --config ./chaintap.yaml

# Build & Quality
npm run build         # Compile TypeScript to dist/
npm run lint          # ESLint check
npm run typecheck     # TypeScript type check
npm run format        # Prettier format

# Testing
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:int      # Integration tests
npm run test:cov      # Coverage report
```

## Architecture

### Core Flow
1. **CLI** (commander.js) parses config → validates with zod
2. **Event Fetcher** calls `getLogs` with pagination (handles 2000-block limits)
3. **ABI Fetcher** retrieves ABIs from Etherscan (or local cache)
4. **Decoder** uses ethers.js `Interface.parseLog()` to decode events
5. **Storage Adapter** batch-inserts events to SQLite/Postgres (deduplicated by tx_hash + log_index)
6. **Provider Pool** manages multi-RPC failover with health tracking

### Key Components

- **`src/core/indexer.ts`**: Main orchestrator that coordinates fetching, decoding, and storage
- **`src/core/event-fetcher.ts`**: Handles paginated `getLogs` calls with block range chunking
- **`src/providers/provider-pool.ts`**: Multi-RPC management with automatic failover on 429/503 errors
- **`src/storage/adapter.ts`**: Interface for storage backends (SQLite/Postgres implementations are identical API)
- **`src/abi/fetcher.ts`**: Fetches ABIs from Etherscan API with local caching

### Storage Schema

Events are stored in dynamic tables per contract:
- Table name: `events_{contract_short_address}`
- Unique constraint on `(transaction_hash, log_index)` prevents duplicates
- `event_data` column stores decoded parameters as JSON (flexibility over rigid schemas)
- Separate `sync_state` table tracks last synced block per contract

### Configuration

Uses YAML config (`chaintap.yaml`) with:
- Contract addresses and event filters
- Multi-provider setup with priorities
- Database type (sqlite/postgres)
- Batch sizes, confirmation depths, poll intervals
- Environment variable interpolation (`${VAR_NAME}`)

## Code Conventions

- **Module system**: ESM (import/export), not CommonJS
- **Async patterns**: Prefer async/await over raw promises
- **Validation**: Use zod for runtime validation of configs and inputs
- **Logging**: Use pino structured logger (never console.log)
- **Error handling**: All RPC calls wrapped in exponential backoff retry logic
- **Type safety**: Strict TypeScript - no `any` types without justification

## Critical Implementation Notes

### RPC Provider Management
- Different providers return different error formats for rate limits
- Must check for: `429` status, `"rate limit"` in message, `"Too Many Requests"`
- Use `provider-pool.ts` to rotate providers automatically on failures
- Track provider health and deprioritize failing endpoints

### Event Deduplication
- **MUST** enforce unique constraint on `(tx_hash, log_index)` in database
- Batch inserts (100 events per transaction) but handle duplicates gracefully
- SQLite uses WAL mode for concurrent read access during indexing

### Reorg Handling
- Only mark events "confirmed" after N confirmations (configurable)
- On new block, verify parent hash matches expected chain
- If reorg detected: delete events from orphaned blocks, re-fetch from common ancestor

### Block Range Limits
- Standard RPC `getLogs` limited to ~2000 blocks per call (varies by provider)
- Event fetcher must chunk requests and handle dynamic adjustment on errors
- Track progress per-contract in `sync_state` table for resumability

## Testing Strategy

### Unit Tests (`tests/unit/`)
- Event decoding with various Solidity types (indexed vs non-indexed params)
- Pagination logic edge cases (start/end block boundaries)
- Config validation (malformed YAML, missing required fields)
- Rate limiter behavior under different error conditions

### Integration Tests (`tests/integration/`)
- SQLite and Postgres adapters with real databases
- Full indexing cycle with local Hardhat node (deploy contract, emit events, verify storage)
- Provider failover simulation (mock 429 errors, verify automatic rotation)

### Test Framework
- **vitest** for test runner (modern, fast, TypeScript native)
- **msw** for mocking RPC HTTP requests in tests

## Common Development Tasks

### Adding a New CLI Command
1. Create command file in `src/cli/commands/`
2. Define command with commander.js syntax
3. Import and register in `src/cli/index.ts`
4. Add config validation schema if needed
5. Write integration test in `tests/integration/cli/`

### Adding a New Storage Backend
1. Implement `StorageAdapter` interface in `src/storage/`
2. Handle schema creation with vendor-specific SQL
3. Implement batch insert with conflict resolution (UPSERT)
4. Add connection pooling/management
5. Write integration tests with real database

### Adding Support for a New Chain
1. Add chain config to `chains.yaml` (chain ID, RPC URLs, block time, confirmation depth)
2. Update `src/core/types.ts` with chain-specific parameters if needed
3. Test with chain-specific contract to verify event decoding
4. Document any chain-specific quirks (e.g., BSC has different `getLogs` limits)

## External APIs

- **Etherscan API**: `https://api.etherscan.io/api?module=contract&action=getabi&address=0x...`
  - Requires API key in `ETHERSCAN_API_KEY` env var
  - Cached locally to avoid repeated calls
  - Fallback to user-provided ABI path in config if API fails

## Performance Targets

- **Historical sync**: 10,000 blocks/minute
- **Live indexing latency**: < 30 seconds behind chain head
- **Memory usage**: < 256MB for typical workload
- **SQLite insert throughput**: 5,000 events/second with batch inserts

## Key Interfaces

```typescript
// Core event structure after decoding
interface DecodedEvent {
  blockNumber: number;
  blockTimestamp: number;
  transactionHash: string;
  logIndex: number;
  contractAddress: string;
  eventName: string;
  eventData: Record<string, unknown>;  // Decoded params
}

// Storage adapter (SQLite/Postgres implement this)
interface StorageAdapter {
  init(): Promise<void>;
  insertEvents(events: DecodedEvent[]): Promise<number>;
  getLastSyncedBlock(contractAddress: string): Promise<number | null>;
  updateSyncState(contractAddress: string, blockNumber: number): Promise<void>;
  queryEvents(filter: EventFilter): Promise<DecodedEvent[]>;
  close(): Promise<void>;
}

// Provider pool for multi-RPC failover
interface ProviderPool {
  getProvider(): Promise<ethers.JsonRpcProvider>;
  reportSuccess(provider: ethers.JsonRpcProvider): void;
  reportFailure(provider: ethers.JsonRpcProvider, error: Error): void;
  getHealthStatus(): ProviderHealth[];
}
```

## Implementation Status

This is currently a **specification-only project** (see `chaintap-event-indexer-spec.md`). Implementation follows this phased approach:

1. **Phase 1** (Weeks 1-2): Core event fetching and decoding
2. **Phase 2** (Weeks 3-4): Storage layer (SQLite + Postgres)
3. **Phase 3** (Weeks 5-6): CLI interface with watch/backfill/status commands
4. **Phase 4** (Weeks 7-8): Multi-provider resilience and reorg handling

When implementing, follow the spec's architecture but remain flexible - real-world RPC behavior may differ from assumptions.
