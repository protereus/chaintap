# ChainTap MVP Implementation Plan

## Project Overview

**Goal:** Implement a zero-config blockchain event indexer CLI tool that indexes EVM blockchain events to SQLite without the complexity of The Graph.

**Target Users:** Indie dApp developers, NFT projects, DeFi protocols needing basic analytics.

**Success Criteria:** Developers can run `chaintap watch --config chaintap.yaml` and have events automatically indexed to queryable SQLite database with <30s latency, handling RPC rate limits and failures gracefully.

---

## Requirements Summary

### Functional Requirements

1. **Event Indexing Core**
   - Fetch events from EVM chains via JSON-RPC `eth_getLogs`
   - Handle pagination for large block ranges (dynamic adjustment per provider)
   - Decode events using contract ABIs from Etherscan or manual config
   - Store decoded events in SQLite with deduplication
   - Track sync progress per contract for resumability

2. **CLI Interface**
   - `watch` command: start live indexing from latest block
   - `backfill` command: sync historical data with from/to block range
   - `status` command: show sync progress for all configured contracts
   - YAML configuration with validation (contracts, providers, database)
   - Environment variable interpolation in config

3. **Multi-Provider Resilience**
   - Pool of RPC providers with priority-based routing
   - Automatic failover on 429/503 errors and timeouts
   - Rate limit detection and provider health tracking
   - Per-provider rate limiting and backoff

4. **Data Quality**
   - No duplicate events (enforce unique tx_hash + log_index)
   - Resumable sync after interruption
   - Clear error messages on config/RPC/database failures
   - Structured logging with appropriate verbosity levels

### Non-Functional Requirements

1. **Performance**
   - Historical sync: 10,000 blocks/minute target
   - Live indexing: <30 second latency behind chain head
   - Memory usage: <256MB for typical workload
   - SQLite insert throughput: batch inserts of 100+ events

2. **Reliability**
   - Graceful handling of RPC provider failures
   - Transaction-safe database updates (atomic sync state updates)
   - Clean shutdown on SIGINT/SIGTERM with state preservation
   - Exit codes for different failure modes (0=success, 1=config, 2=RPC, 3=database)

3. **Usability**
   - Simple YAML config (no GraphQL schemas or complex mappings)
   - Clear error messages for common misconfigurations
   - Minimal dependencies (no external database setup for SQLite)
   - Works on Linux, macOS, Windows (Node.js compatible)

### Explicit Non-Goals (Post-MVP)

- WebSocket support (HTTP polling sufficient for <30s latency)
- Postgres support (SQLite-only for MVP)
- Multi-chain single config (one config = one chain)
- Anonymous event handling
- Proxy contract automatic detection
- REST API for querying events
- Custom event decoders

---

## Acceptance Criteria

### Phase 1: Core Event Fetching

**AC1.1:** Fetch and decode Transfer events from UNI token contract (0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984) for block range 17000000-17001000 using Etherscan ABI
- Verify 1000+ events decoded with correct parameter names and types
- Events include: blockNumber, blockTimestamp, transactionHash, logIndex, eventName, eventData

**AC1.2:** Handle RPC block range limits with dynamic adjustment
- Initial request with 2000 blocks, receive "block range too large" error, automatically retry with 1000 blocks
- Cache working block range limit per provider
- Never reduce below 100 blocks

**AC1.3:** Exponential backoff retry on transient RPC failures
- Simulate 503 error on 2nd request, verify retry after 1s, 2s, 4s delays
- Success on 4th attempt continues indexing without data loss
- Log retry attempts with error context

**AC1.4:** ABI fetching from Etherscan with local cache
- First fetch retrieves from API, second fetch uses cache
- Cache stored in `~/.chaintap/abi-cache/{chain_id}/{address}.json`
- Missing or unverified contract returns clear error: "Contract ABI not verified on Etherscan. Provide manual ABI path in config."

### Phase 2: Storage Layer

**AC2.1:** SQLite schema creation with single events table
```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_address TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  block_timestamp INTEGER NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  event_data TEXT NOT NULL, -- JSON
  indexed_at INTEGER NOT NULL,
  UNIQUE(transaction_hash, log_index)
);
CREATE INDEX idx_contract_block ON events(contract_address, block_number);
CREATE INDEX idx_event_name ON events(contract_address, event_name);
```

**AC2.2:** Batch insert with deduplication
- Insert 500 events in single transaction, attempt to re-insert 100 overlapping events, verify only 400 new rows added
- Unique constraint violation handled gracefully without crashing

**AC2.3:** Sync state tracking with transactional updates
- `sync_state` table tracks last synced block per contract
- Insert events + update sync state in single transaction (atomic)
- Crash simulation during insert: verify rollback leaves consistent state

**AC2.4:** Resume after interruption
- Sync 50,000 blocks, kill process at block 25,000, restart, verify resumes from block 25,001
- No duplicate events inserted, final count matches clean sync

### Phase 3: CLI Interface

**AC3.1:** Config parsing and validation
- Valid config loads successfully
- Invalid address format returns exit code 1 with error: "Invalid contract address: 0xZZZ"
- Missing required field returns error: "Missing required field: chain"
- Environment variable interpolation: `${ALCHEMY_URL}` resolves correctly

**AC3.2:** `watch` command behavior
- Starts from latest block, indexes new blocks as they arrive
- Ctrl+C triggers graceful shutdown: "Shutting down... saving progress" → exit code 0
- Progress logged: "Indexed 150 events (block 19000000-19000100)"

**AC3.3:** `backfill` command with progress reporting
- `chaintap backfill --from-block 17000000 --to-block 17010000`
- Logs progress every 1000 blocks: "Backfill progress: 5000/10000 blocks (50%)"
- Completion message: "Backfilled 12,456 events in 42 seconds"

**AC3.4:** `status` command output
```
Contract: UNI Token (0x1f98...)
  Chain: Ethereum Mainnet (chain_id: 1)
  Events: Transfer, Approval
  Last synced block: 19000050
  Total events: 15,234
  Status: active
```

### Phase 4: Multi-Provider Resilience

**AC4.1:** Provider failover on rate limit
- Configure 2 providers (priority 1, 2)
- Mock primary returns 429 on 3rd request
- Verify secondary takes over within 2 seconds
- No events missed, sync continues seamlessly

**AC4.2:** Health tracking and recovery
- Provider fails 3 times consecutively, marked unhealthy (deprioritized)
- After 60 seconds, health check passes, provider restored to pool
- `status` command shows provider health

**AC4.3:** Rate limit detection patterns
- Detect 429 HTTP status
- Detect "rate limit" in error message
- Detect "Too Many Requests" in error message
- Properly handle different provider error formats (Alchemy, Infura, Llamarpc)

**AC4.4:** Graceful degradation
- All providers fail: log "All RPC providers unavailable, retrying in 30s"
- After 5 consecutive failures: exit code 2 with "Cannot connect to any RPC provider"
- Preserve sync state for manual restart

### Cross-Cutting Acceptance Criteria

**AC-Memory:** Memory usage stays under 256MB during sync of USDT contract (high event volume) over 10,000 blocks

**AC-Performance:** Sync 50,000 blocks of UNI token in under 5 minutes on Ethereum mainnet with standard RPC provider

**AC-Atomicity:** Sync state and events table always consistent - no scenario where `last_synced_block` > max(block_number) in events table

**AC-Exit-Codes:** All error paths return correct exit codes (0=success, 1=config, 2=RPC, 3=database, 4=filesystem)

---

## Technical Architecture

### Revised Database Schema

**Change from spec:** Single `events` table instead of table-per-contract for better scaling and multi-contract queries.

```sql
-- Main events table
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_address TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  block_timestamp INTEGER NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  event_data TEXT NOT NULL,  -- JSON serialized
  indexed_at INTEGER NOT NULL,
  UNIQUE(transaction_hash, log_index)
);

CREATE INDEX idx_contract_block ON events(contract_address, block_number);
CREATE INDEX idx_contract_event ON events(contract_address, event_name);
CREATE INDEX idx_block_number ON events(block_number);

-- Sync progress tracking
CREATE TABLE sync_state (
  contract_address TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  last_block INTEGER NOT NULL,
  last_sync INTEGER NOT NULL,
  status TEXT DEFAULT 'active'
);
```

### Core Interfaces

```typescript
// Core event structure after decoding
interface DecodedEvent {
  contractAddress: string;
  blockNumber: number;
  blockTimestamp: number;
  transactionHash: string;
  logIndex: number;
  eventName: string;
  eventData: Record<string, unknown>;
}

// Storage adapter interface
interface StorageAdapter {
  init(): Promise<void>;
  insertEvents(events: DecodedEvent[]): Promise<number>;
  getLastSyncedBlock(contractAddress: string): Promise<number | null>;
  updateSyncStateAndInsertEvents(
    contractAddress: string,
    blockNumber: number,
    events: DecodedEvent[]
  ): Promise<void>; // Atomic transaction
  queryEvents(filter: EventFilter): Promise<DecodedEvent[]>;
  close(): Promise<void>;
}

// Provider pool interface
interface ProviderPool {
  getProvider(): Promise<ProviderInfo>;
  reportSuccess(providerId: string): void;
  reportFailure(providerId: string, error: Error): void;
  getHealthStatus(): ProviderHealth[];
  getAllProviders(): ProviderInfo[];
}

interface ProviderInfo {
  id: string;
  url: string;
  priority: number;
  provider: ethers.JsonRpcProvider;
}

// Event filter for queries
interface EventFilter {
  contractAddress?: string;
  eventName?: string;
  fromBlock?: number;
  toBlock?: number;
  limit?: number;
  offset?: number;
}
```

### Key Dependencies

```json
{
  "dependencies": {
    "ethers": "^6.13.0",
    "commander": "^12.1.0",
    "better-sqlite3": "^11.5.0",
    "pino": "^9.5.0",
    "pino-pretty": "^11.2.0",
    "zod": "^3.23.0",
    "yaml": "^2.6.0",
    "p-retry": "^6.2.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "msw": "^2.6.0",
    "tsx": "^4.19.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0"
  }
}
```

---

## Implementation Plan

### Phase 0: Project Setup (Week 1 - Days 1-2)

**Goal:** Establish TypeScript project with testing infrastructure and development tooling.

#### Tasks

**Task 0.1: Initialize npm project and dependencies**
- Create `package.json` with all dependencies
- Set up TypeScript with `tsconfig.json` (ESM modules, strict mode)
- Configure `exports` field for library usage
- Add `bin` field pointing to `dist/cli/index.js`
- Test: `npm install` completes without native compilation errors on current platform

**Task 0.2: Set up testing infrastructure**
- Configure vitest with `vitest.config.ts`
- Set up coverage reporting (target: 80% coverage)
- Create test fixtures directory structure: `tests/unit/`, `tests/integration/`, `tests/fixtures/`
- Add sample test contract ABI in fixtures
- Test: `npm test` runs empty test suite successfully

**Task 0.3: Configure linting and formatting**
- Set up ESLint with TypeScript plugin
- Configure Prettier for consistent formatting
- Add `lint`, `format`, `typecheck` scripts to package.json
- Test: `npm run lint` and `npm run typecheck` pass on empty project

**Task 0.4: Create project directory structure**
```
src/
├── cli/
│   ├── index.ts (entry point)
│   ├── commands/ (watch, backfill, status)
│   └── config.ts (YAML parser + zod validation)
├── core/
│   ├── indexer.ts (orchestrator)
│   ├── event-fetcher.ts (paginated getLogs)
│   ├── block-tracker.ts (sync progress)
│   └── types.ts (shared interfaces)
├── providers/
│   ├── provider-pool.ts (multi-RPC management)
│   └── rate-limiter.ts (per-provider limits)
├── storage/
│   ├── adapter.ts (interface)
│   └── sqlite.ts (implementation)
├── abi/
│   ├── fetcher.ts (Etherscan API)
│   ├── cache.ts (local storage)
│   └── decoder.ts (ethers Interface wrapper)
└── utils/
    ├── logger.ts (pino setup)
    ├── retry.ts (exponential backoff)
    ├── errors.ts (typed error classes)
    └── validation.ts (zod schemas)
```

**Task 0.5: Implement core utilities**
- `src/utils/logger.ts`: Pino logger with pretty printing in dev mode
- `src/utils/errors.ts`: Typed error classes (ConfigError, RPCError, StorageError, ABIError)
- `src/utils/retry.ts`: Wrapper around p-retry with logging
- Write unit tests for each utility
- Test: All utility unit tests pass

**Deliverables:**
- Runnable TypeScript project with test infrastructure
- All utilities tested and passing
- Clean `npm run build` produces `dist/` output
- Git repository initialized with `.gitignore`

---

### Phase 1: Core Event Fetching (Week 1-2)

**Goal:** Fetch and decode events from single RPC endpoint with proper pagination and error handling.

#### Task 1.1: ABI Management (TDD)

**File:** `src/abi/fetcher.ts`

**Tests first (test file: `tests/unit/abi/fetcher.test.ts`):**
```typescript
describe('ABIFetcher', () => {
  it('fetches ABI from Etherscan API', async () => {
    // Mock Etherscan API response
    // Verify correct API call with address and API key
  });

  it('returns cached ABI on second fetch', async () => {
    // First call hits API, second reads cache
    // Verify only one network request
  });

  it('throws ABIError for unverified contract', async () => {
    // Mock 404/unverified response
    // Verify error message mentions manual ABI option
  });

  it('uses manual ABI path from config if provided', async () => {
    // Config has abi: "./abis/custom.json"
    // Verify reads from filesystem, skips Etherscan
  });

  it('handles network timeout with retry', async () => {
    // Mock timeout, then success
    // Verify retry logic
  });
});
```

**Implementation:**
```typescript
export class ABIFetcher {
  constructor(
    private cacheDir: string,
    private apiKey?: string
  ) {}

  async getABI(address: string, chainId: number, manualPath?: string): Promise<Interface> {
    // 1. If manualPath provided, read and parse
    // 2. Check cache: ~/.chaintap/abi-cache/{chainId}/{address}.json
    // 3. Fetch from Etherscan/Polygonscan/etc based on chainId
    // 4. Cache result
    // 5. Return ethers.Interface
  }

  private getExplorerAPIUrl(chainId: number): string {
    // Map chainId to block explorer API (Etherscan, Polygonscan, etc.)
  }
}
```

**Acceptance:** AC1.4 tests pass

---

#### Task 1.2: Event Decoding (TDD)

**File:** `src/abi/decoder.ts`

**Tests first:**
```typescript
describe('EventDecoder', () => {
  it('decodes Transfer event with indexed parameters', () => {
    // Standard ERC20 Transfer(address indexed from, address indexed to, uint256 value)
    // Raw log data → decoded params
  });

  it('decodes event with non-indexed bytes32 parameter', () => {
    // Verify bytes32 stored as hex string
  });

  it('decodes event with array parameter', () => {
    // Verify array properly serialized in eventData
  });

  it('handles unknown event signature gracefully', () => {
    // Log signature not in ABI
    // Should return null or throw specific error
  });

  it('decodes multiple events from same transaction', () => {
    // Batch processing
  });
});
```

**Implementation:**
```typescript
export class EventDecoder {
  constructor(private iface: Interface) {}

  decode(log: ethers.Log): DecodedEvent | null {
    try {
      const parsed = this.iface.parseLog({
        topics: log.topics,
        data: log.data
      });

      return {
        contractAddress: log.address,
        blockNumber: log.blockNumber,
        blockTimestamp: 0, // Will be filled by fetcher
        transactionHash: log.transactionHash,
        logIndex: log.index,
        eventName: parsed.name,
        eventData: this.serializeEventData(parsed.args)
      };
    } catch (error) {
      logger.warn({ log, error }, 'Failed to decode event');
      return null;
    }
  }

  private serializeEventData(args: Result): Record<string, unknown> {
    // Convert ethers Result to plain object
    // Handle BigInt → string conversion
    // Handle bytes → hex string
  }
}
```

**Acceptance:** Decodes UNI Transfer events correctly

---

#### Task 1.3: Dynamic Block Range Pagination (TDD)

**File:** `src/core/event-fetcher.ts`

**Tests first:**
```typescript
describe('EventFetcher', () => {
  it('fetches events in chunks respecting initial block size', async () => {
    // fromBlock 1000, toBlock 5000, initial chunk 2000
    // Should make 3 requests: [1000-2999], [3000-4999], [5000]
  });

  it('reduces chunk size on "block range too large" error', async () => {
    // First request fails with range error
    // Retry with half the range
    // Cache new limit for provider
  });

  it('never reduces chunk size below 100 blocks', async () => {
    // Simulate repeated range errors
    // Verify stops at 100 block minimum
  });

  it('enriches events with block timestamp', async () => {
    // getLogs returns logs without timestamp
    // Fetcher calls provider.getBlock() to get timestamp
    // Batch getBlock calls for unique block numbers
  });

  it('handles empty event result', async () => {
    // No events in range, returns empty array
    // Logs info message, doesn't error
  });
});
```

**Implementation:**
```typescript
export class EventFetcher {
  private blockRangeLimits = new Map<string, number>(); // providerId → max range

  constructor(
    private provider: ethers.JsonRpcProvider,
    private providerId: string,
    private decoder: EventDecoder,
    private initialChunkSize = 2000
  ) {}

  async fetchEvents(
    contractAddress: string,
    eventFilter: string[], // Event signatures or names
    fromBlock: number,
    toBlock: number
  ): Promise<DecodedEvent[]> {
    const chunkSize = this.blockRangeLimits.get(this.providerId) ?? this.initialChunkSize;
    const allEvents: DecodedEvent[] = [];

    for (let start = fromBlock; start <= toBlock; start += chunkSize) {
      const end = Math.min(start + chunkSize - 1, toBlock);

      try {
        const logs = await retry(() =>
          this.provider.getLogs({
            address: contractAddress,
            fromBlock: start,
            toBlock: end,
            topics: [eventFilter] // topic[0] = event signature
          }),
          { retries: 5 }
        );

        // Enrich with block timestamps (batch by unique blocks)
        const enriched = await this.enrichWithTimestamps(logs);
        allEvents.push(...enriched);

      } catch (error) {
        if (this.isBlockRangeError(error)) {
          const newSize = Math.max(Math.floor(chunkSize / 2), 100);
          this.blockRangeLimits.set(this.providerId, newSize);
          logger.info(`Reduced block range to ${newSize} for provider ${this.providerId}`);
          // Retry this chunk with new size
          start -= chunkSize; // Reset loop counter
        } else {
          throw error;
        }
      }
    }

    return allEvents;
  }

  private async enrichWithTimestamps(logs: ethers.Log[]): Promise<DecodedEvent[]> {
    // Get unique block numbers
    // Batch fetch blocks
    // Map timestamps to decoded events
  }

  private isBlockRangeError(error: unknown): boolean {
    return error instanceof Error && (
      error.message.includes('block range') ||
      error.message.includes('query returned more than') ||
      error.message.includes('exceeds max')
    );
  }
}
```

**Acceptance:** AC1.2, AC1.3 tests pass

---

#### Task 1.4: Integration Test - End-to-End Event Fetching

**File:** `tests/integration/event-fetcher.integration.test.ts`

**Test:**
```typescript
describe('Event Fetcher Integration', () => {
  it('fetches and decodes UNI Transfer events from mainnet', async () => {
    const provider = new ethers.JsonRpcProvider(process.env.ETH_RPC_URL);
    const abiFetcher = new ABIFetcher('~/.chaintap/abi-cache');
    const iface = await abiFetcher.getABI(UNI_TOKEN_ADDRESS, 1);
    const decoder = new EventDecoder(iface);
    const fetcher = new EventFetcher(provider, 'mainnet-provider', decoder);

    const events = await fetcher.fetchEvents(
      UNI_TOKEN_ADDRESS,
      ['Transfer(address,address,uint256)'],
      17000000,
      17001000
    );

    expect(events.length).toBeGreaterThan(1000);
    expect(events[0]).toMatchObject({
      contractAddress: UNI_TOKEN_ADDRESS,
      eventName: 'Transfer',
      eventData: expect.objectContaining({
        from: expect.stringMatching(/^0x[a-fA-F0-9]{40}$/),
        to: expect.stringMatching(/^0x[a-fA-F0-9]{40}$/),
        value: expect.any(String)
      })
    });
  }, 60000); // 60s timeout for real network call
});
```

**Acceptance:** AC1.1 passes

---

### Phase 2: Storage Layer (Week 3-4)

**Goal:** Persist events to SQLite with transactional sync state updates and resumability.

#### Task 2.1: SQLite Schema and Adapter (TDD)

**File:** `src/storage/sqlite.ts`

**Tests first:**
```typescript
describe('SQLiteAdapter', () => {
  beforeEach(() => {
    // Create temp database for each test
  });

  it('creates tables on init', async () => {
    const adapter = new SQLiteAdapter(':memory:');
    await adapter.init();

    // Query sqlite_master to verify events and sync_state tables exist
  });

  it('inserts events in batch transaction', async () => {
    const adapter = new SQLiteAdapter(':memory:');
    await adapter.init();

    const events = createMockEvents(100);
    const inserted = await adapter.insertEvents(events);

    expect(inserted).toBe(100);
    const count = adapter.queryEvents({}).length;
    expect(count).toBe(100);
  });

  it('handles duplicate events gracefully', async () => {
    // Insert 100 events
    // Re-insert 50 overlapping + 50 new
    // Verify only 50 new rows added, no errors thrown
  });

  it('updates sync state atomically with event insert', async () => {
    // Insert events for contract A, block 1000
    // Verify sync_state.last_block = 1000 for contract A
    // Simulate crash during insert (mock transaction failure)
    // Verify rollback: no events inserted, sync_state unchanged
  });

  it('returns last synced block for contract', async () => {
    await adapter.updateSyncStateAndInsertEvents(CONTRACT_A, 5000, []);
    const lastBlock = await adapter.getLastSyncedBlock(CONTRACT_A);
    expect(lastBlock).toBe(5000);
  });

  it('returns null for contract never synced', async () => {
    const lastBlock = await adapter.getLastSyncedBlock(UNKNOWN_CONTRACT);
    expect(lastBlock).toBeNull();
  });
});
```

**Implementation:**
```typescript
import Database from 'better-sqlite3';

export class SQLiteAdapter implements StorageAdapter {
  private db: Database.Database;

  constructor(private dbPath: string) {}

  async init(): Promise<void> {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL'); // Enable WAL for concurrent reads

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_address TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        block_timestamp INTEGER NOT NULL,
        transaction_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        event_name TEXT NOT NULL,
        event_data TEXT NOT NULL,
        indexed_at INTEGER NOT NULL,
        UNIQUE(transaction_hash, log_index)
      );

      CREATE INDEX IF NOT EXISTS idx_contract_block ON events(contract_address, block_number);
      CREATE INDEX IF NOT EXISTS idx_contract_event ON events(contract_address, event_name);
      CREATE INDEX IF NOT EXISTS idx_block_number ON events(block_number);

      CREATE TABLE IF NOT EXISTS sync_state (
        contract_address TEXT PRIMARY KEY,
        chain_id INTEGER NOT NULL,
        last_block INTEGER NOT NULL,
        last_sync INTEGER NOT NULL,
        status TEXT DEFAULT 'active'
      );
    `);
  }

  async insertEvents(events: DecodedEvent[]): Promise<number> {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO events (
        contract_address, block_number, block_timestamp,
        transaction_hash, log_index, event_name, event_data, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    const transaction = this.db.transaction((events: DecodedEvent[]) => {
      for (const event of events) {
        const result = stmt.run(
          event.contractAddress,
          event.blockNumber,
          event.blockTimestamp,
          event.transactionHash,
          event.logIndex,
          event.eventName,
          JSON.stringify(event.eventData),
          Math.floor(Date.now() / 1000)
        );
        inserted += result.changes;
      }
    });

    transaction(events);
    return inserted;
  }

  async updateSyncStateAndInsertEvents(
    contractAddress: string,
    blockNumber: number,
    events: DecodedEvent[]
  ): Promise<void> {
    const insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO events (
        contract_address, block_number, block_timestamp,
        transaction_hash, log_index, event_name, event_data, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateSyncStmt = this.db.prepare(`
      INSERT INTO sync_state (contract_address, chain_id, last_block, last_sync)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(contract_address) DO UPDATE SET
        last_block = excluded.last_block,
        last_sync = excluded.last_sync
    `);

    const transaction = this.db.transaction((contractAddress: string, chainId: number, blockNumber: number, events: DecodedEvent[]) => {
      for (const event of events) {
        insertStmt.run(
          event.contractAddress,
          event.blockNumber,
          event.blockTimestamp,
          event.transactionHash,
          event.logIndex,
          event.eventName,
          JSON.stringify(event.eventData),
          Math.floor(Date.now() / 1000)
        );
      }

      updateSyncStmt.run(
        contractAddress,
        chainId,
        blockNumber,
        Math.floor(Date.now() / 1000)
      );
    });

    transaction(contractAddress, 1, blockNumber, events); // TODO: pass actual chainId
  }

  async getLastSyncedBlock(contractAddress: string): Promise<number | null> {
    const stmt = this.db.prepare('SELECT last_block FROM sync_state WHERE contract_address = ?');
    const row = stmt.get(contractAddress) as { last_block: number } | undefined;
    return row?.last_block ?? null;
  }

  async queryEvents(filter: EventFilter): Promise<DecodedEvent[]> {
    let query = 'SELECT * FROM events WHERE 1=1';
    const params: unknown[] = [];

    if (filter.contractAddress) {
      query += ' AND contract_address = ?';
      params.push(filter.contractAddress);
    }
    if (filter.eventName) {
      query += ' AND event_name = ?';
      params.push(filter.eventName);
    }
    if (filter.fromBlock) {
      query += ' AND block_number >= ?';
      params.push(filter.fromBlock);
    }
    if (filter.toBlock) {
      query += ' AND block_number <= ?';
      params.push(filter.toBlock);
    }

    query += ' ORDER BY block_number, log_index';

    if (filter.limit) {
      query += ' LIMIT ?';
      params.push(filter.limit);
    }
    if (filter.offset) {
      query += ' OFFSET ?';
      params.push(filter.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as unknown[];

    return rows.map((row: unknown) => this.rowToEvent(row));
  }

  private rowToEvent(row: unknown): DecodedEvent {
    // Parse row to DecodedEvent
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
```

**Acceptance:** AC2.1, AC2.2, AC2.3 tests pass

---

#### Task 2.2: Resumability Integration Test

**File:** `tests/integration/resumability.integration.test.ts`

**Test:**
```typescript
describe('Sync Resumability', () => {
  it('resumes indexing after interruption without duplicates', async () => {
    const dbPath = '/tmp/test-resume.db';
    const adapter = new SQLiteAdapter(dbPath);
    await adapter.init();

    // Simulate first sync: blocks 17000000-17025000
    const events1 = await fetchMockEvents(17000000, 17025000);
    await adapter.updateSyncStateAndInsertEvents(UNI_TOKEN, 17025000, events1);
    const count1 = (await adapter.queryEvents({ contractAddress: UNI_TOKEN })).length;

    // "Restart" - check last synced block
    const lastBlock = await adapter.getLastSyncedBlock(UNI_TOKEN);
    expect(lastBlock).toBe(17025000);

    // Resume from next block: 17025001-17050000
    const events2 = await fetchMockEvents(17025001, 17050000);
    await adapter.updateSyncStateAndInsertEvents(UNI_TOKEN, 17050000, events2);
    const count2 = (await adapter.queryEvents({ contractAddress: UNI_TOKEN })).length;

    // Verify: count2 = count1 + new events (no overlap, no duplicates)
    expect(count2).toBe(count1 + events2.length);

    // Compare with fresh sync of entire range
    const freshDb = new SQLiteAdapter('/tmp/test-fresh.db');
    await freshDb.init();
    const freshEvents = await fetchMockEvents(17000000, 17050000);
    await freshDb.updateSyncStateAndInsertEvents(UNI_TOKEN, 17050000, freshEvents);
    const freshCount = (await freshDb.queryEvents({ contractAddress: UNI_TOKEN })).length;

    expect(count2).toBe(freshCount);
  });
});
```

**Acceptance:** AC2.4 passes

---

### Phase 3: CLI Interface (Week 5-6)

**Goal:** User-friendly CLI with watch, backfill, status commands and config validation.

#### Task 3.1: Config Schema and Validation (TDD)

**File:** `src/cli/config.ts`

**Tests first:**
```typescript
describe('Config Validation', () => {
  it('parses valid config', () => {
    const yaml = `
      chain: ethereum
      database:
        type: sqlite
        path: ./data/events.db
      contracts:
        - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
          name: "UNI Token"
          events: ["Transfer", "Approval"]
          from_block: 17000000
      providers:
        - url: "https://eth.llamarpc.com"
          priority: 1
    `;

    const config = parseConfig(yaml);
    expect(config.contracts).toHaveLength(1);
    expect(config.contracts[0].address).toBe('0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984');
  });

  it('rejects invalid contract address', () => {
    const yaml = `
      chain: ethereum
      contracts:
        - address: "0xZZZ"
          events: ["Transfer"]
    `;

    expect(() => parseConfig(yaml)).toThrow(ConfigError);
    expect(() => parseConfig(yaml)).toThrow(/Invalid contract address/);
  });

  it('rejects missing required fields', () => {
    const yaml = `
      contracts:
        - address: "0x..."
    `;
    // Missing chain
    expect(() => parseConfig(yaml)).toThrow(/Missing required field: chain/);
  });

  it('interpolates environment variables', () => {
    process.env.TEST_RPC_URL = 'https://test.rpc';
    const yaml = `
      chain: ethereum
      providers:
        - url: "\${TEST_RPC_URL}"
    `;

    const config = parseConfig(yaml);
    expect(config.providers[0].url).toBe('https://test.rpc');
  });

  it('defaults from_block to null (latest)', () => {
    const yaml = `
      chain: ethereum
      contracts:
        - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
          events: ["Transfer"]
    `;

    const config = parseConfig(yaml);
    expect(config.contracts[0].from_block).toBeNull();
  });
});
```

**Implementation:**
```typescript
import { z } from 'zod';
import YAML from 'yaml';

const ContractConfigSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
  name: z.string().optional(),
  events: z.array(z.string()).min(1),
  from_block: z.number().int().positive().nullable().default(null),
  abi: z.string().optional() // Path to custom ABI
});

const ProviderConfigSchema = z.object({
  url: z.string().url(),
  priority: z.number().int().positive().default(1)
});

const ConfigSchema = z.object({
  chain: z.enum(['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc']),
  database: z.object({
    type: z.literal('sqlite'),
    path: z.string()
  }),
  contracts: z.array(ContractConfigSchema).min(1).max(100),
  providers: z.array(ProviderConfigSchema).min(1),
  options: z.object({
    batch_size: z.number().int().positive().default(2000),
    confirmations: z.number().int().nonnegative().default(12),
    poll_interval: z.number().int().positive().default(15000),
    max_retries: z.number().int().positive().default(5)
  }).optional()
});

export type Config = z.infer<typeof ConfigSchema>;

export function parseConfig(yamlContent: string): Config {
  // Interpolate environment variables
  const interpolated = yamlContent.replace(/\$\{(\w+)\}/g, (_, varName) => {
    const value = process.env[varName];
    if (!value) {
      throw new ConfigError(`Environment variable ${varName} not set`);
    }
    return value;
  });

  const raw = YAML.parse(interpolated);

  try {
    return ConfigSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('\n');
      throw new ConfigError(`Config validation failed:\n${message}`);
    }
    throw error;
  }
}

export function loadConfigFile(path: string): Config {
  const content = fs.readFileSync(path, 'utf-8');
  return parseConfig(content);
}
```

**Acceptance:** AC3.1 tests pass

---

#### Task 3.2: Watch Command Implementation

**File:** `src/cli/commands/watch.ts`

**Implementation:**
```typescript
import { Command } from 'commander';

export function createWatchCommand(): Command {
  return new Command('watch')
    .description('Start live indexing from latest block')
    .option('-c, --config <path>', 'Config file path', './chaintap.yaml')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (options) => {
      try {
        const config = loadConfigFile(options.config);
        const logger = createLogger(options.verbose);

        const storage = new SQLiteAdapter(config.database.path);
        await storage.init();

        const providerPool = new ProviderPool(config.providers);

        const indexer = new Indexer(config, storage, providerPool, logger);

        // Graceful shutdown on SIGINT/SIGTERM
        process.on('SIGINT', async () => {
          logger.info('Shutting down... saving progress');
          await indexer.stop();
          await storage.close();
          process.exit(0);
        });

        await indexer.startWatch();

      } catch (error) {
        if (error instanceof ConfigError) {
          console.error(`Config error: ${error.message}`);
          process.exit(1);
        }
        if (error instanceof RPCError) {
          console.error(`RPC error: ${error.message}`);
          process.exit(2);
        }
        if (error instanceof StorageError) {
          console.error(`Database error: ${error.message}`);
          process.exit(3);
        }
        throw error;
      }
    });
}
```

**File:** `src/core/indexer.ts` (orchestrator)

```typescript
export class Indexer {
  private running = false;

  constructor(
    private config: Config,
    private storage: StorageAdapter,
    private providerPool: ProviderPool,
    private logger: Logger
  ) {}

  async startWatch(): Promise<void> {
    this.running = true;
    this.logger.info('Starting watch mode...');

    for (const contractConfig of this.config.contracts) {
      this.watchContract(contractConfig).catch(error => {
        this.logger.error({ error, contract: contractConfig.address }, 'Contract watch failed');
      });
    }
  }

  private async watchContract(contractConfig: ContractConfig): Promise<void> {
    const { address, events, from_block } = contractConfig;

    // Get last synced block or use latest
    let currentBlock = await this.storage.getLastSyncedBlock(address);
    if (currentBlock === null) {
      if (from_block !== null) {
        currentBlock = from_block;
      } else {
        const provider = (await this.providerPool.getProvider()).provider;
        currentBlock = await provider.getBlockNumber();
        this.logger.info({ contract: address, startBlock: currentBlock }, 'Starting from latest block');
      }
    }

    // Poll for new blocks
    while (this.running) {
      try {
        const providerInfo = await this.providerPool.getProvider();
        const latestBlock = await providerInfo.provider.getBlockNumber();

        if (latestBlock > currentBlock) {
          const toBlock = latestBlock - (this.config.options?.confirmations ?? 12);

          if (toBlock > currentBlock) {
            await this.indexBlocks(contractConfig, currentBlock + 1, toBlock, providerInfo);
            currentBlock = toBlock;
          }
        }

        this.providerPool.reportSuccess(providerInfo.id);

        await new Promise(resolve => setTimeout(resolve, this.config.options?.poll_interval ?? 15000));

      } catch (error) {
        this.logger.error({ error, contract: address }, 'Error in watch loop');
        await new Promise(resolve => setTimeout(resolve, 5000)); // Back off on error
      }
    }
  }

  private async indexBlocks(
    contractConfig: ContractConfig,
    fromBlock: number,
    toBlock: number,
    providerInfo: ProviderInfo
  ): Promise<void> {
    const abiFetcher = new ABIFetcher(/* ... */);
    const iface = await abiFetcher.getABI(
      contractConfig.address,
      this.getChainId(this.config.chain),
      contractConfig.abi
    );

    const decoder = new EventDecoder(iface);
    const fetcher = new EventFetcher(providerInfo.provider, providerInfo.id, decoder);

    const events = await fetcher.fetchEvents(
      contractConfig.address,
      contractConfig.events,
      fromBlock,
      toBlock
    );

    if (events.length > 0) {
      await this.storage.updateSyncStateAndInsertEvents(
        contractConfig.address,
        toBlock,
        events
      );

      this.logger.info({
        contract: contractConfig.address,
        blocks: `${fromBlock}-${toBlock}`,
        events: events.length
      }, 'Indexed events');
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.logger.info('Indexer stopped');
  }

  private getChainId(chain: string): number {
    const chainIds: Record<string, number> = {
      ethereum: 1,
      polygon: 137,
      arbitrum: 42161,
      optimism: 10,
      base: 8453,
      bsc: 56
    };
    return chainIds[chain];
  }
}
```

**Acceptance:** AC3.2 tests pass

---

#### Task 3.3: Backfill and Status Commands

**File:** `src/cli/commands/backfill.ts`

```typescript
export function createBackfillCommand(): Command {
  return new Command('backfill')
    .description('Sync historical data for a block range')
    .requiredOption('--from-block <number>', 'Start block', parseInt)
    .requiredOption('--to-block <number>', 'End block (or "latest")')
    .option('-c, --config <path>', 'Config file path', './chaintap.yaml')
    .action(async (options) => {
      const config = loadConfigFile(options.config);
      const storage = new SQLiteAdapter(config.database.path);
      await storage.init();

      const providerPool = new ProviderPool(config.providers);
      const indexer = new Indexer(config, storage, providerPool, logger);

      const toBlock = options.toBlock === 'latest'
        ? await (await providerPool.getProvider()).provider.getBlockNumber()
        : parseInt(options.toBlock);

      const totalBlocks = toBlock - options.fromBlock;
      let processedBlocks = 0;

      // Progress reporting
      const progressInterval = setInterval(() => {
        const percent = Math.floor((processedBlocks / totalBlocks) * 100);
        console.log(`Backfill progress: ${processedBlocks}/${totalBlocks} blocks (${percent}%)`);
      }, 5000);

      const startTime = Date.now();

      try {
        for (const contractConfig of config.contracts) {
          await indexer.indexBlocks(
            contractConfig,
            options.fromBlock,
            toBlock,
            await providerPool.getProvider()
          );
          processedBlocks = toBlock - options.fromBlock;
        }

        clearInterval(progressInterval);
        const duration = Math.floor((Date.now() - startTime) / 1000);
        const eventCount = (await storage.queryEvents({ fromBlock: options.fromBlock })).length;
        console.log(`Backfilled ${eventCount} events in ${duration} seconds`);

      } catch (error) {
        clearInterval(progressInterval);
        throw error;
      }
    });
}
```

**File:** `src/cli/commands/status.ts`

```typescript
export function createStatusCommand(): Command {
  return new Command('status')
    .description('Show sync progress for all configured contracts')
    .option('-c, --config <path>', 'Config file path', './chaintap.yaml')
    .action(async (options) => {
      const config = loadConfigFile(options.config);
      const storage = new SQLiteAdapter(config.database.path);
      await storage.init();

      for (const contractConfig of config.contracts) {
        const lastBlock = await storage.getLastSyncedBlock(contractConfig.address);
        const eventCount = (await storage.queryEvents({ contractAddress: contractConfig.address })).length;

        console.log(`Contract: ${contractConfig.name || contractConfig.address}`);
        console.log(`  Address: ${contractConfig.address}`);
        console.log(`  Chain: ${config.chain} (chain_id: ${getChainId(config.chain)})`);
        console.log(`  Events: ${contractConfig.events.join(', ')}`);
        console.log(`  Last synced block: ${lastBlock ?? 'Never synced'}`);
        console.log(`  Total events: ${eventCount}`);
        console.log(`  Status: active\n`);
      }

      await storage.close();
    });
}
```

**Acceptance:** AC3.3, AC3.4 tests pass

---

### Phase 4: Multi-Provider Resilience (Week 7-8)

**Goal:** Handle RPC provider failures with automatic failover, rate limit detection, and health tracking.

#### Task 4.1: Provider Pool with Health Tracking (TDD)

**File:** `src/providers/provider-pool.ts`

**Tests first:**
```typescript
describe('ProviderPool', () => {
  it('returns highest priority healthy provider', async () => {
    const pool = new ProviderPool([
      { url: 'http://provider1', priority: 1 },
      { url: 'http://provider2', priority: 2 }
    ]);

    const provider = await pool.getProvider();
    expect(provider.url).toBe('http://provider1');
  });

  it('fails over to lower priority provider after repeated failures', async () => {
    const pool = new ProviderPool([
      { url: 'http://provider1', priority: 1 },
      { url: 'http://provider2', priority: 2 }
    ]);

    // Report 3 failures for provider1
    pool.reportFailure('provider1', new Error('Connection failed'));
    pool.reportFailure('provider1', new Error('Connection failed'));
    pool.reportFailure('provider1', new Error('Connection failed'));

    const provider = await pool.getProvider();
    expect(provider.url).toBe('http://provider2');
  });

  it('recovers unhealthy provider after cooldown period', async () => {
    const pool = new ProviderPool([
      { url: 'http://provider1', priority: 1 }
    ], { healthCheckInterval: 100, failureThreshold: 2 });

    pool.reportFailure('provider1', new Error('Failed'));
    pool.reportFailure('provider1', new Error('Failed'));

    // Provider1 marked unhealthy
    expect(pool.getHealthStatus()[0].healthy).toBe(false);

    // Wait for health check + report success
    await new Promise(resolve => setTimeout(resolve, 150));
    pool.reportSuccess('provider1');

    expect(pool.getHealthStatus()[0].healthy).toBe(true);
  });

  it('throws error when all providers unhealthy', async () => {
    const pool = new ProviderPool([
      { url: 'http://provider1', priority: 1 }
    ]);

    pool.reportFailure('provider1', new Error('Failed'));
    pool.reportFailure('provider1', new Error('Failed'));
    pool.reportFailure('provider1', new Error('Failed'));

    await expect(pool.getProvider()).rejects.toThrow(RPCError);
    await expect(pool.getProvider()).rejects.toThrow(/Cannot connect to any RPC provider/);
  });
});
```

**Implementation:**
```typescript
interface ProviderHealth {
  id: string;
  url: string;
  priority: number;
  healthy: boolean;
  consecutiveFailures: number;
  lastFailure: number | null;
  lastSuccess: number | null;
}

export class ProviderPool {
  private providers = new Map<string, ProviderInfo>();
  private health = new Map<string, ProviderHealth>();

  constructor(
    providerConfigs: Array<{ url: string; priority: number }>,
    private options = {
      failureThreshold: 3,
      healthCheckInterval: 60000, // 60s
      cooldownPeriod: 30000 // 30s
    }
  ) {
    for (const config of providerConfigs) {
      const id = `provider-${config.url}`;
      const provider = new ethers.JsonRpcProvider(config.url, undefined, {
        staticNetwork: true // Disable automatic network detection
      });

      this.providers.set(id, {
        id,
        url: config.url,
        priority: config.priority,
        provider
      });

      this.health.set(id, {
        id,
        url: config.url,
        priority: config.priority,
        healthy: true,
        consecutiveFailures: 0,
        lastFailure: null,
        lastSuccess: null
      });
    }
  }

  async getProvider(): Promise<ProviderInfo> {
    // Sort by: healthy first, then priority, then least recent failure
    const sortedProviders = Array.from(this.health.values())
      .filter(h => h.healthy || this.shouldRetryUnhealthy(h))
      .sort((a, b) => {
        if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
        if (a.priority !== b.priority) return a.priority - b.priority;
        return (a.lastFailure ?? 0) - (b.lastFailure ?? 0);
      });

    if (sortedProviders.length === 0) {
      throw new RPCError('Cannot connect to any RPC provider. All providers unhealthy.');
    }

    const providerHealth = sortedProviders[0];
    return this.providers.get(providerHealth.id)!;
  }

  reportSuccess(providerId: string): void {
    const health = this.health.get(providerId);
    if (!health) return;

    health.consecutiveFailures = 0;
    health.lastSuccess = Date.now();
    health.healthy = true;
  }

  reportFailure(providerId: string, error: Error): void {
    const health = this.health.get(providerId);
    if (!health) return;

    health.consecutiveFailures++;
    health.lastFailure = Date.now();

    if (health.consecutiveFailures >= this.options.failureThreshold) {
      health.healthy = false;
      logger.warn({ providerId, url: health.url, error }, 'Provider marked unhealthy');
    }
  }

  private shouldRetryUnhealthy(health: ProviderHealth): boolean {
    if (health.healthy) return true;
    if (!health.lastFailure) return true;

    const timeSinceFailure = Date.now() - health.lastFailure;
    return timeSinceFailure > this.options.cooldownPeriod;
  }

  getHealthStatus(): ProviderHealth[] {
    return Array.from(this.health.values());
  }

  getAllProviders(): ProviderInfo[] {
    return Array.from(this.providers.values());
  }
}
```

**Acceptance:** AC4.1, AC4.2 tests pass

---

#### Task 4.2: Rate Limit Detection

**File:** `src/providers/rate-limiter.ts`

**Tests first:**
```typescript
describe('Rate Limit Detection', () => {
  it('detects 429 HTTP status', () => {
    const error = new Error('Request failed with status 429');
    expect(isRateLimitError(error)).toBe(true);
  });

  it('detects "rate limit" in message', () => {
    const error = new Error('You have exceeded your rate limit');
    expect(isRateLimitError(error)).toBe(true);
  });

  it('detects "Too Many Requests"', () => {
    const error = new Error('Too Many Requests');
    expect(isRateLimitError(error)).toBe(true);
  });

  it('returns false for non-rate-limit errors', () => {
    const error = new Error('Network timeout');
    expect(isRateLimitError(error)).toBe(false);
  });
});
```

**Implementation:**
```typescript
export function isRateLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();

  return (
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('quota exceeded')
  );
}

export function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();

  return (
    message.includes('timeout') ||
    message.includes('etimedout') ||
    message.includes('econnreset')
  );
}
```

**Acceptance:** AC4.3 tests pass

---

#### Task 4.3: Integration Test - Provider Failover

**File:** `tests/integration/provider-failover.integration.test.ts`

**Test:**
```typescript
describe('Provider Failover', () => {
  it('automatically fails over on rate limit error', async () => {
    // Mock provider1 to return 429 on 3rd call
    // Mock provider2 to succeed

    const mockProvider1 = createMockProvider();
    let callCount = 0;
    mockProvider1.getLogs = vi.fn(async () => {
      callCount++;
      if (callCount === 3) {
        throw new Error('429 Too Many Requests');
      }
      return [];
    });

    const mockProvider2 = createMockProvider();
    mockProvider2.getLogs = vi.fn(async () => []);

    const pool = new ProviderPool([
      { url: 'http://provider1', priority: 1 },
      { url: 'http://provider2', priority: 2 }
    ]);

    // Replace internal providers with mocks
    pool['providers'].set('provider1', { id: 'provider1', url: 'http://provider1', priority: 1, provider: mockProvider1 });
    pool['providers'].set('provider2', { id: 'provider2', url: 'http://provider2', priority: 2, provider: mockProvider2 });

    const fetcher = new EventFetcher(pool, /* ... */);

    // Make multiple requests
    for (let i = 0; i < 5; i++) {
      try {
        const providerInfo = await pool.getProvider();
        await providerInfo.provider.getLogs({/* ... */});
        pool.reportSuccess(providerInfo.id);
      } catch (error) {
        if (isRateLimitError(error)) {
          pool.reportFailure('provider1', error);
        }
      }
    }

    // Verify provider2 was used after provider1 failures
    const health = pool.getHealthStatus();
    expect(health.find(h => h.id === 'provider1')?.healthy).toBe(false);
    expect(mockProvider2.getLogs).toHaveBeenCalled();
  });
});
```

**Acceptance:** AC4.1 passes

---

#### Task 4.4: Integrate Provider Pool into Indexer

**File:** `src/core/indexer.ts` (update)

Update `watchContract` and `indexBlocks` methods to use provider pool with error handling:

```typescript
private async watchContract(contractConfig: ContractConfig): Promise<void> {
  // ... existing code ...

  while (this.running) {
    let providerInfo: ProviderInfo | null = null;

    try {
      providerInfo = await this.providerPool.getProvider();
      const latestBlock = await providerInfo.provider.getBlockNumber();

      // ... indexing logic ...

      this.providerPool.reportSuccess(providerInfo.id);

    } catch (error) {
      if (providerInfo) {
        if (isRateLimitError(error)) {
          this.logger.warn({ provider: providerInfo.url }, 'Rate limit hit, failing over');
          this.providerPool.reportFailure(providerInfo.id, error);
        } else if (isTimeoutError(error)) {
          this.logger.warn({ provider: providerInfo.url }, 'Request timeout, failing over');
          this.providerPool.reportFailure(providerInfo.id, error);
        } else {
          this.logger.error({ error, provider: providerInfo.url }, 'Unexpected error');
          this.providerPool.reportFailure(providerInfo.id, error);
        }
      }

      // Check if all providers are down
      const healthStatus = this.providerPool.getHealthStatus();
      const allUnhealthy = healthStatus.every(h => !h.healthy);

      if (allUnhealthy) {
        this.logger.error('All RPC providers unavailable, retrying in 30s...');
        await new Promise(resolve => setTimeout(resolve, 30000));
      } else {
        await new Promise(resolve => setTimeout(resolve, 5000)); // Normal backoff
      }
    }
  }
}
```

**Acceptance:** AC4.4 passes

---

### Phase 5: Polish & Documentation (Week 9)

**Goal:** Final integration testing, performance validation, and user documentation.

#### Task 5.1: End-to-End Integration Test

**File:** `tests/e2e/full-indexing.e2e.test.ts`

```typescript
describe('End-to-End Indexing', () => {
  it('indexes UNI token events from mainnet with all features', async () => {
    const configYaml = `
      chain: ethereum
      database:
        type: sqlite
        path: /tmp/e2e-test.db
      contracts:
        - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
          name: "UNI Token"
          events: ["Transfer"]
          from_block: 17000000
      providers:
        - url: "${process.env.ETH_RPC_URL}"
          priority: 1
      options:
        batch_size: 1000
        confirmations: 12
    `;

    // Write config to temp file
    const configPath = '/tmp/e2e-chaintap.yaml';
    fs.writeFileSync(configPath, configYaml);

    // Run backfill command
    const result = await exec(`node dist/cli/index.js backfill --from-block 17000000 --to-block 17010000 --config ${configPath}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Backfilled');
    expect(result.stdout).toMatch(/\d+ events in \d+ seconds/);

    // Verify database contents
    const storage = new SQLiteAdapter('/tmp/e2e-test.db');
    await storage.init();

    const events = await storage.queryEvents({
      contractAddress: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
      eventName: 'Transfer'
    });

    expect(events.length).toBeGreaterThan(1000);
    expect(events[0].eventData).toHaveProperty('from');
    expect(events[0].eventData).toHaveProperty('to');
    expect(events[0].eventData).toHaveProperty('value');

    // Verify no duplicates
    const uniqueTxLogs = new Set(events.map(e => `${e.transactionHash}-${e.logIndex}`));
    expect(uniqueTxLogs.size).toBe(events.length);
  }, 300000); // 5min timeout
});
```

**Acceptance:** Full end-to-end flow works on real mainnet data

---

#### Task 5.2: Performance Validation

**File:** `tests/performance/sync-speed.perf.test.ts`

```typescript
describe('Performance Validation', () => {
  it('meets 10,000 blocks/minute sync target', async () => {
    const storage = new SQLiteAdapter('/tmp/perf-test.db');
    await storage.init();

    const config = loadConfigFile('./test-config.yaml');
    const providerPool = new ProviderPool(config.providers);
    const indexer = new Indexer(config, storage, providerPool, logger);

    const startTime = Date.now();

    await indexer.indexBlocks(
      config.contracts[0],
      17000000,
      17050000, // 50,000 blocks
      await providerPool.getProvider()
    );

    const duration = (Date.now() - startTime) / 1000; // seconds
    const blocksPerMinute = (50000 / duration) * 60;

    expect(blocksPerMinute).toBeGreaterThan(10000);
    console.log(`Sync speed: ${Math.floor(blocksPerMinute)} blocks/minute`);
  }, 600000);

  it('keeps memory usage under 256MB', async () => {
    const initialMemory = process.memoryUsage().heapUsed;

    // Index high-volume contract (USDT)
    await indexer.indexBlocks(
      { address: USDT_ADDRESS, events: ['Transfer'] },
      17000000,
      17010000,
      await providerPool.getProvider()
    );

    const peakMemory = process.memoryUsage().heapUsed;
    const memoryIncreaseMB = (peakMemory - initialMemory) / 1024 / 1024;

    expect(memoryIncreaseMB).toBeLessThan(256);
    console.log(`Peak memory increase: ${Math.floor(memoryIncreaseMB)}MB`);
  });
});
```

**Acceptance:** AC-Memory, AC-Performance pass

---

#### Task 5.3: Create README and Examples

**File:** `README.md`

```markdown
# ChainTap

> Zero-config blockchain event indexer. Index EVM chain events to SQLite without GraphQL, AssemblyScript, or complex setup.

## Quick Start

```bash
npm install -g chaintap

# Create config file
cat > chaintap.yaml <<EOF
chain: ethereum
database:
  type: sqlite
  path: ./events.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "UNI Token"
    events:
      - Transfer
      - Approval

providers:
  - url: "https://eth.llamarpc.com"
    priority: 1
EOF

# Start indexing
chaintap watch
```

## Features

- **Zero config**: Just specify contract address and event names
- **Automatic pagination**: Handles RPC block range limits
- **Multi-provider**: Automatic failover on rate limits
- **Resumable**: Picks up where it left off after interruption
- **SQLite storage**: No external database setup required

## Commands

### `chaintap watch`
Start live indexing from latest block.

### `chaintap backfill --from-block N --to-block M`
Sync historical data for a block range.

### `chaintap status`
Show sync progress for all configured contracts.

## Configuration

See [Configuration Guide](./docs/configuration.md) for full details.

## Querying Events

Events are stored in SQLite with this schema:

```sql
SELECT * FROM events
WHERE contract_address = '0x...'
  AND event_name = 'Transfer'
  AND block_number BETWEEN 17000000 AND 17010000
ORDER BY block_number, log_index;
```

## Requirements

- Node.js 18+
- RPC provider URL (Alchemy, Infura, public RPC)
- (Optional) Etherscan API key for ABI fetching

## License

MIT
```

**File:** `docs/configuration.md`

Full configuration reference with:
- All config options explained
- Environment variable interpolation
- Multi-contract setup
- Provider priority system
- Chain-specific settings

**File:** `examples/`

- `basic-erc20.yaml`: Simple ERC20 token indexing
- `multi-contract.yaml`: Multiple contracts example
- `advanced.yaml`: All options configured

**Acceptance:** Documentation covers all user-facing features

---

#### Task 5.4: Package for npm Publication

- Update `package.json` with proper metadata (description, keywords, repository, license)
- Add `files` field to include only `dist/` and docs
- Set up npm publish workflow
- Test installation: `npm pack && npm install -g ./chaintap-*.tgz`
- Verify `chaintap --version` and `chaintap --help` work

**Acceptance:** Package can be installed globally and CLI is accessible

---

## Risk Mitigation Strategies

### Risk 1: RPC Provider Rate Limits Block Development

**Mitigation:**
- Use multiple free RPC providers in rotation from day 1
- Implement mock RPC server for tests (no real network calls in unit tests)
- Cache getLogs responses during development for faster iteration

### Risk 2: better-sqlite3 Native Compilation Issues

**Mitigation:**
- Document Node.js version requirement (18+ with native addon support)
- Test `npm install` on Linux, macOS, Windows in CI
- Provide pre-compiled binaries or Docker image as fallback

### Risk 3: Etherscan API Unavailable or Rate Limited

**Mitigation:**
- Implement aggressive local ABI caching (never expire)
- Support manual ABI file paths in config as primary option
- Document how to provide ABI manually for unverified contracts

### Risk 4: Memory Usage Exceeds 256MB on High-Volume Contracts

**Mitigation:**
- Implement streaming event processing (don't buffer entire block range)
- Process events in chunks of 1000 max
- Add memory usage monitoring and warnings in status command

### Risk 5: Database Write Performance Bottleneck

**Mitigation:**
- Use WAL mode for SQLite (concurrent reads)
- Batch inserts (100+ events per transaction)
- Add database size monitoring to detect when migration to Postgres needed

### Risk 6: Scope Creep (WebSocket, Postgres, Multi-chain)

**Mitigation:**
- Explicitly document as post-MVP in README
- Provide clear migration path in docs
- Focus on getting SQLite + HTTP polling rock-solid first

---

## Verification & Testing Strategy

### Unit Test Coverage Target: 80%+

Focus on:
- ABI fetching and caching logic
- Event decoding with various Solidity types
- Block range pagination and adjustment
- Provider pool health tracking
- Config validation with all edge cases

### Integration Tests (Real Network)

- Fetch and decode actual UNI token events from mainnet
- Full sync cycle with SQLite storage
- Resume after interruption (kill process mid-sync)
- Provider failover with mocked rate limit responses

### End-to-End Test

- Install package globally
- Run all CLI commands with real config
- Verify database contents match expected events
- Measure performance (blocks/minute, memory usage)

### Manual Testing Checklist

- [ ] Install on Linux, macOS, Windows
- [ ] Test with different RPC providers (Alchemy, Infura, Llamarpc)
- [ ] Test with unverified contract (expect clear error)
- [ ] Test with invalid config (expect helpful error messages)
- [ ] Test Ctrl+C during sync (verify graceful shutdown)
- [ ] Test restart after crash (verify resume works)
- [ ] Query events with SQLite CLI to verify schema

---

## Dependencies & Constraints

### Required External Services

1. **RPC Provider** (user-provided)
   - Ethereum mainnet JSON-RPC endpoint
   - Free tier sufficient for MVP (Llamarpc, Ankr)
   - No API key required for testing

2. **Etherscan API** (optional)
   - Free tier: 5 calls/second
   - Used only for ABI fetching (cached locally)
   - Can be skipped if manual ABI provided

### Platform Requirements

- **Node.js**: 18+ (ESM support, native fetch API)
- **OS**: Linux, macOS, Windows (better-sqlite3 must compile)
- **Disk**: 100MB+ for typical workload (SQLite database grows with events)

### Development Environment

- **Testing**: Requires real RPC provider for integration tests (set `ETH_RPC_URL` env var)
- **Build**: Standard TypeScript toolchain (no special requirements)

---

## Success Metrics

### MVP Launch Criteria

- [ ] All acceptance criteria pass (AC1.1 through AC4.4)
- [ ] Unit test coverage ≥80%
- [ ] Performance targets met (10K blocks/min, <256MB memory)
- [ ] Documentation complete (README, config guide, examples)
- [ ] Package installs cleanly on Linux, macOS, Windows
- [ ] End-to-end test passes on real mainnet data

### Post-Launch Indicators

- Successfully indexes at least 3 different contracts on mainnet
- Runs continuously for 24+ hours without crashes
- Handles at least one real provider outage with failover
- Community feedback on ease of setup (<5 minutes to first indexed event)

---

## Timeline Summary

| Phase | Duration | Key Deliverable |
|-------|----------|----------------|
| Phase 0: Setup | 2 days | Project structure, testing infrastructure |
| Phase 1: Event Fetching | 1.5 weeks | Fetch & decode events with pagination |
| Phase 2: Storage | 1.5 weeks | SQLite adapter with resumability |
| Phase 3: CLI | 1.5 weeks | watch, backfill, status commands |
| Phase 4: Resilience | 1.5 weeks | Multi-provider failover |
| Phase 5: Polish | 1 week | Integration tests, docs, npm package |
| **Total** | **9 weeks** | **Production-ready MVP** |

---

## Next Steps After Plan Approval

1. **Create git repository** with initial commit (README, .gitignore, LICENSE)
2. **Set up CI/CD** (GitHub Actions for tests, linting, build)
3. **Start Phase 0** implementation (project setup tasks)
4. **Schedule weekly check-ins** to review progress and adjust plan

---

## Questions for Implementation

These should be resolved during development:

1. Should we log to file or just stdout? (Decision: stdout only for MVP, pipe to file if needed)
2. What's the behavior when disk space runs out? (Decision: fail gracefully with clear error)
3. Should status command show estimated time to sync? (Decision: defer to post-MVP)
4. How to handle proxy contracts? (Decision: not supported in MVP, document limitation)
