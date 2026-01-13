# ChainTap: Zero-Config Event Indexer

> CLI tool that indexes blockchain events to SQLite/Postgres without GraphQL, AssemblyScript, or complex setup.

---

## Project Context

### What This Is
A Node.js CLI and library that watches EVM blockchain events and writes them to a database. Users specify a contract address and event names—the tool handles pagination, rate limits, and storage automatically.

### Why It Exists
The Graph requires GraphQL schemas, AssemblyScript mappings, and manifest configuration—a 2-3 week learning curve. Developers who just need event data in a queryable format have no lightweight alternative. Standard RPC calls limit event queries to 20,000 block ranges, forcing hundreds of sequential requests.

### Who It's For
- Indie dApp developers building dashboards
- NFT projects tracking transfers and sales
- DeFi protocols needing basic analytics
- Data analysts who know SQL but not GraphQL

---

## Architecture Overview

```
chaintap/
├── src/
│   ├── cli/
│   │   ├── index.ts          # CLI entry point (commander.js)
│   │   ├── commands/
│   │   │   ├── watch.ts      # Start indexing command
│   │   │   ├── backfill.ts   # Historical sync command
│   │   │   └── status.ts     # Show sync progress
│   │   └── config.ts         # YAML config parser
│   │
│   ├── core/
│   │   ├── indexer.ts        # Main indexing orchestrator
│   │   ├── event-fetcher.ts  # Paginated event retrieval
│   │   ├── block-tracker.ts  # Track sync progress
│   │   └── types.ts          # Shared TypeScript types
│   │
│   ├── providers/
│   │   ├── provider-pool.ts  # Multi-RPC management
│   │   ├── rate-limiter.ts   # Request throttling
│   │   └── health-check.ts   # Endpoint monitoring
│   │
│   ├── storage/
│   │   ├── adapter.ts        # Storage interface
│   │   ├── sqlite.ts         # SQLite implementation
│   │   ├── postgres.ts       # Postgres implementation
│   │   └── schema.ts         # Table definitions
│   │
│   ├── abi/
│   │   ├── fetcher.ts        # Fetch ABI from Etherscan
│   │   ├── parser.ts         # Extract event signatures
│   │   └── cache.ts          # Local ABI cache
│   │
│   └── utils/
│       ├── logger.ts         # Structured logging (pino)
│       ├── retry.ts          # Exponential backoff
│       └── validation.ts     # Input validation (zod)
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
│
├── bin/
│   └── chaintap.js         # npm bin entry
│
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── README.md
```

---

## Technical Specifications

### Core Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| ethers | Blockchain interaction | ^6.x |
| commander | CLI framework | ^12.x |
| better-sqlite3 | SQLite storage | ^11.x |
| pg | Postgres storage | ^8.x |
| pino | Structured logging | ^9.x |
| zod | Schema validation | ^3.x |
| yaml | Config parsing | ^2.x |

### Supported Chains

MVP targets EVM-compatible chains with standard JSON-RPC:
- Ethereum mainnet/testnets
- Polygon
- Arbitrum
- Optimism
- Base
- BSC

Chain config stored in `chains.yaml` with RPC endpoints, block times, and confirmation depths.

### Database Schema

```sql
-- Core events table (created per contract)
CREATE TABLE events_{contract_short} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_number INTEGER NOT NULL,
  block_timestamp INTEGER NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  event_data JSON NOT NULL,
  indexed_at INTEGER DEFAULT (unixepoch()),
  
  UNIQUE(transaction_hash, log_index)
);

CREATE INDEX idx_block ON events_{contract_short}(block_number);
CREATE INDEX idx_event ON events_{contract_short}(event_name);
CREATE INDEX idx_timestamp ON events_{contract_short}(block_timestamp);

-- Sync progress tracking
CREATE TABLE sync_state (
  contract_address TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  last_block INTEGER NOT NULL,
  last_sync INTEGER NOT NULL,
  status TEXT DEFAULT 'active'
);
```

### Configuration Format

```yaml
# chaintap.yaml
chain: ethereum
database:
  type: sqlite  # or postgres
  path: ./data/events.db  # for sqlite
  # connection: postgres://... # for postgres

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "UNI Token"
    events:
      - Transfer
      - Approval
    from_block: 15000000  # optional, defaults to latest

  - address: "0x..."
    abi: "./abis/custom.json"  # optional custom ABI
    events: ["*"]  # all events

providers:
  - url: "https://eth.llamarpc.com"
    priority: 1
  - url: "${ALCHEMY_URL}"  # env var interpolation
    priority: 2

options:
  batch_size: 2000        # blocks per request
  confirmations: 12       # reorg safety
  poll_interval: 15000    # ms between checks
  max_retries: 5
```

---

## Implementation Phases

### Phase 1: Core Event Fetching (Week 1-2)

**Goal:** Fetch and decode events from a single RPC endpoint.

```
Progress Checklist:
- [ ] Set up TypeScript project with ESM modules
- [ ] Implement event-fetcher.ts with pagination
- [ ] Handle getLogs block range limits (2000 blocks default)
- [ ] Implement ABI fetching from Etherscan API
- [ ] Decode event parameters using ethers.js Interface
- [ ] Add exponential backoff retry logic
- [ ] Unit tests for event fetching and decoding
```

**Key Implementation Notes:**
- Use `ethers.Contract.interface.parseLog()` for decoding
- Etherscan ABI API: `https://api.etherscan.io/api?module=contract&action=getabi`
- Store raw decoded args as JSON, not individual columns (flexibility)

### Phase 2: Storage Layer (Week 3-4)

**Goal:** Persist events to SQLite and Postgres with identical interface.

```
Progress Checklist:
- [ ] Define StorageAdapter interface (insert, query, getLastBlock)
- [ ] Implement SQLite adapter with better-sqlite3
- [ ] Implement Postgres adapter with pg
- [ ] Create dynamic table schemas per contract
- [ ] Handle duplicate detection (tx_hash + log_index)
- [ ] Implement sync_state tracking
- [ ] Integration tests with real databases
```

**Key Implementation Notes:**
- Use prepared statements for performance
- Batch inserts (100 events per transaction)
- SQLite WAL mode for concurrent reads

### Phase 3: CLI Interface (Week 5-6)

**Goal:** User-friendly CLI with watch, backfill, and status commands.

```
Progress Checklist:
- [ ] Set up commander.js with subcommands
- [ ] Implement config file parsing with zod validation
- [ ] watch command: start live indexing
- [ ] backfill command: sync historical data
- [ ] status command: show progress per contract
- [ ] Add --config flag for custom config path
- [ ] Add --verbose and --quiet output modes
- [ ] Environment variable interpolation in config
```

**CLI Usage Examples:**
```bash
# Quick start with defaults
npx chaintap watch --contract 0x... --events Transfer

# Using config file
chaintap watch --config ./chaintap.yaml

# Backfill historical data
chaintap backfill --from-block 15000000 --to-block latest

# Check sync status
chaintap status
```

### Phase 4: Multi-Provider & Resilience (Week 7-8)

**Goal:** Handle RPC failures gracefully with provider rotation.

```
Progress Checklist:
- [ ] Implement provider-pool.ts with health tracking
- [ ] Add automatic failover on 429/503 errors
- [ ] Implement rate limiter per provider
- [ ] Add WebSocket support for real-time events
- [ ] Handle chain reorganisations (reorg depth config)
- [ ] Graceful shutdown with progress save
- [ ] End-to-end tests with mock RPC failures
```

**Reorg Handling Strategy:**
1. Only mark events as "confirmed" after N confirmations
2. On new block, check if parent hash matches
3. If mismatch, delete events from orphaned blocks and re-fetch

---

## Testing Strategy

### Unit Tests
- Event decoding with various ABI types
- Pagination logic edge cases
- Config validation
- Rate limiter behaviour

### Integration Tests
- SQLite and Postgres adapters
- Full indexing cycle with local Hardhat node
- Provider failover simulation

### Test Commands
```bash
npm test              # Run all tests
npm run test:unit     # Unit tests only
npm run test:int      # Integration tests
npm run test:cov      # Coverage report
```

---

## Development Workflow

### Initial Setup
```bash
# Clone and install
git clone <repo>
cd chaintap
npm install

# Copy example config
cp chaintap.example.yaml chaintap.yaml

# Set up environment
export ETHERSCAN_API_KEY=your_key
export ALCHEMY_URL=https://eth-mainnet.g.alchemy.com/v2/your_key

# Run in development
npm run dev -- watch --config ./chaintap.yaml
```

### Build Commands
```bash
npm run build         # Compile TypeScript
npm run lint          # ESLint check
npm run typecheck     # TypeScript check
npm run format        # Prettier format
```

### Release Process
```bash
npm version patch     # Bump version
npm run build
npm publish
```

---

## Error Handling Patterns

### RPC Errors
```typescript
// Retry with exponential backoff
const result = await retry(
  () => provider.getLogs(filter),
  {
    retries: 5,
    minTimeout: 1000,
    factor: 2,
    onRetry: (err, attempt) => {
      logger.warn({ err, attempt }, 'Retrying getLogs');
    }
  }
);
```

### Rate Limit Detection
```typescript
// Different providers return different error formats
function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.message.includes('429') ||
      err.message.includes('rate limit') ||
      err.message.includes('Too Many Requests')
    );
  }
  return false;
}
```

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Historical sync | 10,000 blocks/minute |
| Live indexing latency | < 30 seconds |
| Memory usage | < 256MB |
| SQLite insert throughput | 5,000 events/second |

---

## Key Interfaces

### StorageAdapter
```typescript
interface StorageAdapter {
  init(): Promise<void>;
  insertEvents(events: DecodedEvent[]): Promise<number>;
  getLastSyncedBlock(contractAddress: string): Promise<number | null>;
  updateSyncState(contractAddress: string, blockNumber: number): Promise<void>;
  queryEvents(filter: EventFilter): Promise<DecodedEvent[]>;
  close(): Promise<void>;
}
```

### DecodedEvent
```typescript
interface DecodedEvent {
  blockNumber: number;
  blockTimestamp: number;
  transactionHash: string;
  logIndex: number;
  contractAddress: string;
  eventName: string;
  eventData: Record<string, unknown>;
}
```

### ProviderPool
```typescript
interface ProviderPool {
  getProvider(): Promise<ethers.JsonRpcProvider>;
  reportSuccess(provider: ethers.JsonRpcProvider): void;
  reportFailure(provider: ethers.JsonRpcProvider, error: Error): void;
  getHealthStatus(): ProviderHealth[];
}
```

---

## Future Enhancements (Post-MVP)

1. **Webhook notifications** - POST to URL on new events
2. **REST API** - Query indexed events via HTTP
3. **Multiple chains** - Single config, multiple chains
4. **Event filtering** - Index only events matching conditions
5. **Prometheus metrics** - Sync progress, error rates

---

## Questions to Resolve During Development

1. Should we support custom event decoders for non-standard ABIs?
2. How to handle proxy contracts with implementation upgrades?
3. Should we add a "dry run" mode that shows what would be indexed?
4. Is there demand for CSV/JSON export alongside database storage?

---

## CLAUDE.md Template

When starting development, create this `CLAUDE.md` in the project root:

```markdown
# ChainTap Development

## Bash Commands
- `npm run dev` - Run in development mode with ts-node
- `npm run build` - Compile TypeScript to dist/
- `npm run test` - Run all tests
- `npm run lint` - ESLint check
- `npm run typecheck` - TypeScript type check

## Code Style
- Use ESM imports (import/export), not CommonJS
- Prefer async/await over raw promises
- Use zod for runtime validation
- Log with pino logger, not console.log
- Errors should be typed and include context

## Project Structure
- `src/cli/` - Commander.js CLI commands
- `src/core/` - Business logic
- `src/storage/` - Database adapters
- `src/providers/` - RPC provider management

## Testing
- Unit tests go in `tests/unit/`
- Integration tests in `tests/integration/`
- Use vitest for testing framework
- Mock RPC calls with msw

## Important Notes
- Always handle rate limit errors with exponential backoff
- Events must be deduplicated by (tx_hash, log_index)
- SQLite uses WAL mode for concurrent access
```
