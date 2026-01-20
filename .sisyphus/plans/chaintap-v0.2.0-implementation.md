# ChainTap v0.2.0 Implementation Plan

**Version**: 0.2.0
**Goal**: Memory-efficient historical backfill + Multi-chain support
**Based on**: Extended testing results (6+ days, 43K events, identified memory limits)
**Created**: 2026-01-20
**Status**: Ready for implementation

---

## Executive Summary

### Background

Extended testing (145+ hours) revealed:
- ✅ **Watch mode**: Production-ready (160 MB stable, zero crashes)
- ⚠️ **Load test**: Crashed at 2 GB after indexing 6.5M blocks (91% complete)
- ❌ **Multi-chain**: Not tested due to Etherscan V2 API issues

### v0.2.0 Objectives

1. **Memory Optimization**: Enable 10M+ block historical syncs with <1 GB RAM
2. **Multi-Chain Support**: Test and validate Polygon, Arbitrum, Base
3. **Reliability**: Add checkpoint/resume for interrupted syncs
4. **Documentation**: Update requirements and troubleshooting

### Success Criteria

- [ ] Backfill 10M blocks (USDT contract) using <1 GB peak memory
- [ ] Successfully index 100K blocks on each of 3 new chains
- [ ] Crash-resume works within 1000 blocks of interruption point
- [ ] All 155+ unit tests still passing
- [ ] Watch mode maintains <256 MB over 24+ hours (regression test)

---

## Phase 1: Memory Optimization (Critical Path)

**Goal**: Fix the 2 GB crash during historical backfill

### Problem Analysis

**Root Cause** (from Metis analysis):
- `EventFetcher.fetchEvents()` accumulates ALL logs in memory: `allLogs.push(...logs)`
- `blockTimestampCache` grows unbounded (50+ MB for 6.5M blocks)
- No memory cleanup between batches
- Single large transaction for entire backfill range

**Memory Budget**:
- Target: <1 GB peak for 10M block syncs
- Allocation:
  - Event processing: 512 MB max
  - Block cache: 100 MB max (LRU eviction)
  - Overhead: 388 MB buffer

### Task 1.1: Implement Streaming Event Processing

**File**: `src/core/event-fetcher.ts`

**Changes**:
1. Convert `fetchEvents()` to async generator/iterator pattern
2. Yield events in batches instead of accumulating
3. Add configurable batch size (default: 50K events)

**Implementation**:
```typescript
// OLD (accumulates in memory)
const allLogs: ethers.Log[] = [];
for (const chunk of chunks) {
  const logs = await fetchChunk(chunk);
  allLogs.push(...logs); // MEMORY ISSUE
}
return allLogs;

// NEW (streaming)
async *fetchEventsStream(
  contractAddress: string,
  eventFilter: string[],
  fromBlock: number,
  toBlock: number,
  batchSize: number = 50000
): AsyncGenerator<EnrichedEvent[]> {
  const chunks = createChunks(fromBlock, toBlock);
  let batchBuffer: EnrichedEvent[] = [];

  for (const chunk of chunks) {
    const logs = await this.fetchChunk(chunk);
    const decoded = await this.decodeAndEnrich(logs);

    batchBuffer.push(...decoded);

    if (batchBuffer.length >= batchSize) {
      yield batchBuffer;
      batchBuffer = []; // CLEAR MEMORY
    }
  }

  if (batchBuffer.length > 0) {
    yield batchBuffer;
  }
}
```

**Acceptance Criteria**:
- [ ] EventFetcher yields events in batches of 50K max
- [ ] Memory usage for fetchEvents call stays <512 MB
- [ ] All existing tests pass with new implementation
- [ ] Performance maintained (10K+ blocks/min)

**Testing**:
```bash
# Memory profiling test
NODE_OPTIONS='--expose-gc --max-old-space-size=512' npm run test:memory-profile

# Unit test
npm run test -- tests/unit/core/event-fetcher.test.ts
```

**Risks**:
- Breaking change to internal API (Indexer depends on this)
- Performance regression if batching too aggressive
- Complexity increase in error handling

**Mitigation**:
- Keep old method as fallback for small ranges
- Add performance benchmarks before/after
- Wrap generator in try/catch with cleanup

---

### Task 1.2: Add LRU Cache for Block Timestamps

**File**: `src/core/event-fetcher.ts`

**Problem**: `blockTimestampCache: Map<number, number>` grows to 50+ MB

**Solution**: Implement LRU cache with eviction

**Implementation**:
```typescript
import { LRUCache } from 'lru-cache'; // Add dependency

class EventFetcher {
  private blockTimestampCache: LRUCache<number, number>;

  constructor(...) {
    this.blockTimestampCache = new LRUCache({
      max: 100000, // Keep 100K blocks in cache
      maxSize: 100 * 1024 * 1024, // 100 MB limit
      sizeCalculation: () => 8, // 8 bytes per entry (number + number)
    });
  }
}
```

**Changes**:
1. Add `lru-cache` dependency to package.json
2. Replace `Map` with `LRUCache` in EventFetcher
3. Configure size limits and eviction policy
4. Update tests to work with LRU semantics

**Acceptance Criteria**:
- [ ] Block cache never exceeds 100 MB
- [ ] Cache hit rate >90% for sequential blocks
- [ ] Existing timestamp enrichment tests pass
- [ ] No performance regression

**Dependencies**: `npm install lru-cache`

---

### Task 1.3: Implement Batch Commits in Storage

**File**: `src/storage/sqlite.ts`

**Current Issue**: Single transaction for entire backfill range

**Solution**: Commit in batches with configurable size

**Implementation**:
```typescript
class SQLiteAdapter {
  private pendingEvents: EventRow[] = [];
  private readonly BATCH_COMMIT_SIZE = 10000; // Configurable

  async insertEventsBatched(
    contractAddress: string,
    chainId: number,
    events: EnrichedEvent[]
  ): Promise<void> {
    for (const event of events) {
      this.pendingEvents.push(this.toRow(event));

      if (this.pendingEvents.length >= this.BATCH_COMMIT_SIZE) {
        await this.flushBatch(contractAddress, chainId);
      }
    }
  }

  private async flushBatch(
    contractAddress: string,
    chainId: number
  ): Promise<void> {
    const batch = this.pendingEvents.splice(0);

    this.db.transaction(() => {
      for (const row of batch) {
        this.insertStmt.run(row);
      }
      this.updateSyncState(contractAddress, chainId, lastBlock);
    })();

    // Force GC hint after big commit
    if (global.gc) {
      global.gc();
    }
  }
}
```

**Acceptance Criteria**:
- [ ] Events committed in batches of 10K
- [ ] Sync state updated with each batch
- [ ] Memory freed after each commit
- [ ] Transaction isolation maintained
- [ ] No data loss on crash

**Testing**:
```bash
# Test crash recovery
npm run test:crash-recovery
```

---

### Task 1.4: Update Indexer for Streaming

**File**: `src/core/indexer.ts`

**Changes**: Consume streaming event fetcher

**Implementation**:
```typescript
async indexBlocks(
  contractConfig: ContractConfig,
  fromBlock: number,
  toBlock: number
): Promise<void> {
  // ... existing setup ...

  const fetcher = new EventFetcher(...);
  const storage = this.storage;

  // Streaming consumption
  for await (const eventBatch of fetcher.fetchEventsStream(...)) {
    await storage.insertEventsBatched(
      contractAddress,
      chainId,
      eventBatch
    );

    this.logger.debug({
      batchSize: eventBatch.length,
      heapUsed: process.memoryUsage().heapUsed,
    }, 'Batch committed');
  }

  // Final flush
  await storage.flushPending();
}
```

**Acceptance Criteria**:
- [ ] Indexer uses streaming API
- [ ] Memory usage logged per batch
- [ ] Progress visible during long syncs
- [ ] Backfill command works end-to-end

---

### Task 1.5: Add Memory Monitoring

**File**: `src/utils/memory-monitor.ts` (new)

**Purpose**: Track and log memory usage, warn on high usage

**Implementation**:
```typescript
export class MemoryMonitor {
  private warningThreshold = 0.8; // 80% of max
  private maxHeapMB: number;

  constructor(maxHeapMB?: number) {
    this.maxHeapMB = maxHeapMB || this.getDefaultHeap();
  }

  check(): MemoryStats {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    const heapTotalMB = usage.heapTotal / 1024 / 1024;
    const percentUsed = heapUsedMB / this.maxHeapMB;

    return {
      heapUsedMB,
      heapTotalMB,
      percentUsed,
      warning: percentUsed > this.warningThreshold,
    };
  }

  async waitIfHighMemory(): Promise<void> {
    const stats = this.check();
    if (stats.warning) {
      this.logger.warn({ stats }, 'High memory usage, pausing...');
      if (global.gc) global.gc();
      await this.sleep(1000);
    }
  }
}
```

**Acceptance Criteria**:
- [ ] Memory monitor tracks heap usage
- [ ] Warnings logged at 80% threshold
- [ ] Integration with Indexer backfill loop
- [ ] Tests for memory calculation

---

### Task 1.6: Add Configuration for Memory Limits

**File**: `src/cli/config.ts`

**Add to schema**:
```typescript
options: z.object({
  // ... existing options ...
  memory_options: z.object({
    max_heap_mb: z.number().optional(), // Max heap size
    batch_commit_size: z.number().default(10000),
    max_events_in_memory: z.number().default(50000),
    enable_gc_hints: z.boolean().default(true),
  }).optional(),
})
```

**Example config**:
```yaml
options:
  batch_size: 10
  memory_options:
    max_heap_mb: 1024 # 1 GB limit
    batch_commit_size: 10000
    max_events_in_memory: 50000
```

**Acceptance Criteria**:
- [ ] Configuration schema updated
- [ ] Default values sensible
- [ ] Validation errors for invalid values
- [ ] Documentation in README

---

## Phase 2: Multi-Chain Support

**Goal**: Test and validate Polygon, Arbitrum, Base chains

### Task 2.1: Fix Etherscan V2 API Integration

**File**: `src/abi/fetcher.ts`

**Current State**: Only Ethereum uses `/v2/api`, others use `/api`

**Investigation Needed**:
1. Check if Polygonscan, Arbiscan, Basescan have V2 endpoints
2. Document API differences per chain
3. Update URL construction logic

**Implementation**:
```typescript
const EXPLORER_CONFIGS: Record<number, ExplorerConfig> = {
  1: { // Ethereum
    url: 'https://api.etherscan.io/v2/api',
    version: 2,
    requiresChainId: true,
  },
  137: { // Polygon
    url: 'https://api.polygonscan.com/api', // Check if v2 exists
    version: 1, // Update if v2 available
    requiresChainId: false,
  },
  42161: { // Arbitrum
    url: 'https://api.arbiscan.io/api',
    version: 1,
    requiresChainId: false,
  },
  8453: { // Base
    url: 'https://api.basescan.org/api',
    version: 1,
    requiresChainId: false,
  },
  // ... other chains
};

async getABI(address: string, chainId: number): Promise<Interface> {
  const config = EXPLORER_CONFIGS[chainId];
  if (!config) {
    throw new ABIError(`Unsupported chain: ${chainId}`);
  }

  const url = new URL(config.url);
  if (config.requiresChainId) {
    url.searchParams.set('chainid', String(chainId));
  }
  // ... rest of implementation
}
```

**Acceptance Criteria**:
- [ ] ABI fetch works for all 6 chains
- [ ] Correct API version used per chain
- [ ] Proper error messages for unsupported chains
- [ ] Tests for each chain's API

**Testing**:
```bash
# Manual verification
ETHERSCAN_API_KEY=xxx node -e "
  const { ABIFetcher } = require('./dist/abi/fetcher');
  const fetcher = new ABIFetcher('.', process.env.ETHERSCAN_API_KEY);

  // Test each chain
  fetcher.getABI('0x...', 137); // Polygon
  fetcher.getABI('0x...', 42161); // Arbitrum
  fetcher.getABI('0x...', 8453); // Base
"
```

---

### Task 2.2: Add Chain-Specific RPC Configurations

**File**: `src/cli/config.ts` and `src/core/indexer.ts`

**Problem**: Different chains have different limits

**Solution**: Add per-chain defaults

**Implementation**:
```typescript
const CHAIN_DEFAULTS: Record<Chain, ChainConfig> = {
  ethereum: {
    batch_size: 10, // Conservative for free tier
    max_block_range: 10, // Alchemy free tier
    confirmations: 12,
  },
  polygon: {
    batch_size: 50,
    max_block_range: 100,
    confirmations: 128, // More needed on Polygon
  },
  arbitrum: {
    batch_size: 1000,
    max_block_range: 100000, // Arbitrum handles huge ranges
    confirmations: 20,
  },
  base: {
    batch_size: 100,
    max_block_range: 1000,
    confirmations: 12,
  },
  // ...
};

// Merge with user config
function applyChainDefaults(config: Config): Config {
  const defaults = CHAIN_DEFAULTS[config.chain];
  return {
    ...config,
    options: {
      ...defaults,
      ...config.options, // User overrides
    },
  };
}
```

**Acceptance Criteria**:
- [ ] Sensible defaults per chain
- [ ] User can override defaults
- [ ] Documentation of chain-specific limits
- [ ] Tests for default merging

---

### Task 2.3: Multi-Chain Integration Tests

**File**: `tests/integration/multi-chain.test.ts` (new)

**Purpose**: Validate each chain works end-to-end

**Test Cases**:
```typescript
describe('Multi-Chain Integration', () => {
  it('indexes Polygon USDC transfers', async () => {
    const config = {
      chain: 'polygon',
      contracts: [{
        address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC
        events: ['Transfer'],
      }],
      providers: [{ url: 'https://polygon-rpc.com' }],
    };

    await indexer.indexBlocks(config, 50000000, 50010000);

    const events = await storage.getEvents(...);
    expect(events.length).toBeGreaterThan(0);
  });

  // Similar tests for Arbitrum and Base
});
```

**Test Contracts**:
- Polygon: USDC (0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359)
- Arbitrum: USDC (0xaf88d065e77c8cC2239327C5EDb3A432268e5831)
- Base: USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)

**Test Range**: 10,000 blocks each (quick validation)

**Acceptance Criteria**:
- [ ] All 3 chains index successfully
- [ ] Events decoded correctly
- [ ] No RPC errors with public endpoints
- [ ] Test completes in <5 minutes

---

### Task 2.4: Rate Limiting for Block Explorers

**File**: `src/abi/fetcher.ts`

**Problem**: Multiple contracts = many API calls = rate limit bans

**Solution**: Add rate limiter

**Implementation**:
```typescript
import pLimit from 'p-limit';

class ABIFetcher {
  private apiLimiter = pLimit(1); // 1 request at a time
  private lastCallTime = 0;
  private minDelayMs = 200; // 5 calls/second max

  async getABI(address: string, chainId: number): Promise<Interface> {
    return this.apiLimiter(async () => {
      // Rate limit delay
      const now = Date.now();
      const elapsed = now - this.lastCallTime;
      if (elapsed < this.minDelayMs) {
        await this.sleep(this.minDelayMs - elapsed);
      }

      this.lastCallTime = Date.now();

      // ... existing fetch logic
    });
  }
}
```

**Acceptance Criteria**:
- [ ] Max 5 API calls/second
- [ ] No rate limit errors during multi-contract setup
- [ ] Minimal delay (<1s) for single contract
- [ ] Tests for rate limiting behavior

---

## Phase 3: Checkpoint & Resume

**Goal**: Allow interrupted syncs to resume gracefully

### Task 3.1: Design Checkpoint Format

**File**: `src/core/checkpoint.ts` (new)

**Format** (JSON):
```json
{
  "version": "0.2.0",
  "contract": "0x...",
  "chain_id": 1,
  "backfill": {
    "start_block": 17000000,
    "target_block": 24234184,
    "current_block": 21000000,
    "events_indexed": 125000,
    "started_at": "2026-01-14T16:37:00Z",
    "last_update": "2026-01-15T02:00:00Z"
  }
}
```

**Atomic Write**:
```typescript
async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
  const tmpFile = `${this.checkpointPath}.tmp`;
  await fs.writeFile(tmpFile, JSON.stringify(checkpoint, null, 2));
  await fs.rename(tmpFile, this.checkpointPath); // Atomic on POSIX
}
```

**Acceptance Criteria**:
- [ ] Checkpoint file human-readable
- [ ] Atomic write (no corruption)
- [ ] Includes progress metadata
- [ ] Version for future compatibility

---

### Task 3.2: Implement Checkpoint Manager

**File**: `src/core/checkpoint.ts`

**Methods**:
```typescript
class CheckpointManager {
  async save(contract: string, progress: Progress): Promise<void>;
  async load(contract: string): Promise<Progress | null>;
  async clear(contract: string): Promise<void>;
  async list(): Promise<string[]>;
}
```

**Storage Location**: `.chaintap/checkpoints/`

**Acceptance Criteria**:
- [ ] Create checkpoint every N blocks (configurable)
- [ ] Load checkpoint on resume
- [ ] Clear checkpoint on successful completion
- [ ] Handle missing/corrupt checkpoints gracefully

---

### Task 3.3: Integrate Checkpoints into Backfill

**File**: `src/cli/commands/backfill.ts` and `src/core/indexer.ts`

**Logic**:
```typescript
async backfill(fromBlock: number, toBlock: number): Promise<void> {
  // Check for existing checkpoint
  const checkpoint = await this.checkpoints.load(contractAddress);

  if (checkpoint && checkpoint.target_block === toBlock) {
    this.logger.info('Resuming from checkpoint', {
      resumeBlock: checkpoint.current_block,
    });
    fromBlock = checkpoint.current_block + 1;
  }

  // Normal backfill with periodic checkpoints
  for await (const batch of this.streamBlocks(fromBlock, toBlock)) {
    await this.processBatch(batch);

    if (batch.lastBlock % 10000 === 0) {
      await this.checkpoints.save(contractAddress, {
        current_block: batch.lastBlock,
        events_indexed: this.totalEvents,
      });
    }
  }

  // Clear checkpoint on completion
  await this.checkpoints.clear(contractAddress);
}
```

**Acceptance Criteria**:
- [ ] Checkpoint saved every 10K blocks
- [ ] Resume picks up within 10K blocks
- [ ] Checkpoint cleared on success
- [ ] Works across process restarts

**Testing**:
```bash
# Start backfill
npm run backfill -- --from 17000000 --to 18000000 &

# Kill after 30 seconds
sleep 30 && kill $!

# Resume should continue
npm run backfill -- --from 17000000 --to 18000000
```

---

### Task 3.4: Add Resume Flag to CLI

**File**: `src/cli/commands/backfill.ts`

**Option**: `--resume` or `--no-resume`

**Usage**:
```bash
# Auto-resume from checkpoint (default)
chaintap backfill --from 17000000 --to 24234184

# Force restart from beginning
chaintap backfill --from 17000000 --to 24234184 --no-resume
```

**Acceptance Criteria**:
- [ ] Default: auto-resume if checkpoint exists
- [ ] `--no-resume` starts fresh
- [ ] Clear error if checkpoint incompatible
- [ ] Documented in --help

---

## Phase 4: Testing & Validation

**Goal**: Ensure all changes work correctly

### Task 4.1: Memory Profile Tests

**File**: `tests/memory/backfill-profile.test.ts` (new)

**Purpose**: Measure peak memory during large backfill

**Implementation**:
```typescript
it('indexes 1M blocks under 1GB memory', async () => {
  const monitor = new MemoryMonitor(1024);

  let peakMemory = 0;
  const checkMemory = setInterval(() => {
    const stats = monitor.check();
    peakMemory = Math.max(peakMemory, stats.heapUsedMB);
  }, 1000);

  await indexer.indexBlocks(config, 17000000, 18000000);

  clearInterval(checkMemory);

  expect(peakMemory).toBeLessThan(1024);
});
```

**Run with**:
```bash
NODE_OPTIONS='--max-old-space-size=1024' npm run test:memory
```

**Acceptance Criteria**:
- [ ] 1M block test completes
- [ ] Peak memory <1 GB
- [ ] Test runs in CI
- [ ] Results documented

---

### Task 4.2: Crash Recovery Tests

**File**: `tests/integration/crash-recovery.test.ts` (new)

**Scenarios**:
1. Kill during batch commit
2. Kill between batches
3. Kill during checkpoint write
4. Corrupted checkpoint file

**Implementation**:
```typescript
it('recovers from crash during indexing', async () => {
  const child = fork('./dist/cli/index.js', [
    'backfill',
    '--from', '17000000',
    '--to', '17100000',
  ]);

  // Kill after 10 seconds
  await sleep(10000);
  child.kill('SIGKILL');

  // Resume
  await runBackfill({
    fromBlock: 17000000,
    toBlock: 17100000,
  });

  // Verify completion
  const state = await storage.getSyncState(...);
  expect(state.lastBlock).toBe(17100000);
});
```

**Acceptance Criteria**:
- [ ] All 4 scenarios handled
- [ ] No data loss
- [ ] Resume within 1000 blocks
- [ ] Documented behavior

---

### Task 4.3: Multi-Chain Live Tests

**File**: `tests/integration/multi-chain-live.test.ts`

**Purpose**: Real tests against live chains

**Execution**:
```bash
# Run against testnets first
npm run test:multi-chain -- --network testnet

# Then mainnets
npm run test:multi-chain -- --network mainnet
```

**Acceptance Criteria**:
- [ ] 100K blocks on Polygon mainnet
- [ ] 100K blocks on Arbitrum mainnet
- [ ] 100K blocks on Base mainnet
- [ ] Events decoded correctly
- [ ] <1 GB memory usage each

---

### Task 4.4: Regression Tests

**File**: All existing tests

**Ensure**:
- [ ] All 155 existing unit tests pass
- [ ] Watch mode still works (24+ hour test)
- [ ] Performance maintained (10K+ blocks/min)
- [ ] No breaking changes to public API

**CI Pipeline**:
```yaml
# .github/workflows/test.yml
name: Test Suite
on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm test

  memory-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run test:memory

  integration-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run test:integration
```

---

## Phase 5: Documentation

**Goal**: Update all documentation for v0.2.0

### Task 5.1: Update README.md

**Sections to update**:

1. **System Requirements**:
```markdown
## System Requirements

- Node.js 18+
- Memory Requirements:
  - **Real-time indexing**: 256 MB minimum
  - **Historical sync (<1M blocks)**: 512 MB - 1 GB
  - **Historical sync (1M-10M blocks)**: 1-2 GB
  - **Historical sync (10M+ blocks)**: 2-4 GB recommended

For large historical syncs, increase heap:
\`\`\`bash
NODE_OPTIONS='--max-old-space-size=4096' chaintap backfill --from 17000000 --to latest
\`\`\`
```

2. **Multi-Chain Support**:
```markdown
## Supported Chains

| Chain | Status | Notes |
|-------|--------|-------|
| Ethereum | ✅ Production | Fully tested |
| Polygon | ✅ Stable | Requires 128 confirmations |
| Arbitrum | ✅ Stable | Supports large block ranges |
| Base | ✅ Stable | - |
| Optimism | ⚠️ Experimental | Limited testing |
| BSC | ⚠️ Experimental | Limited testing |
```

3. **Checkpoint/Resume**:
```markdown
## Checkpoint & Resume

Long-running backfills automatically save progress:

\`\`\`bash
# Start backfill
chaintap backfill --from 17000000 --to 24234184

# If interrupted, resume automatically:
chaintap backfill --from 17000000 --to 24234184
# (Picks up where it left off)

# Force restart:
chaintap backfill --from 17000000 --to 24234184 --no-resume
\`\`\`

Checkpoints saved to: \`.chaintap/checkpoints/\`
```

**Acceptance Criteria**:
- [ ] All new features documented
- [ ] Memory requirements clear
- [ ] Code examples updated
- [ ] Troubleshooting section expanded

---

### Task 5.2: Update CLAUDE.md

**Add sections**:

1. **Memory Optimization Architecture**
2. **Checkpoint System Design**
3. **Multi-Chain Configuration**
4. **Testing Strategy for v0.2.0**

**Acceptance Criteria**:
- [ ] AI can understand memory optimization approach
- [ ] Checkpoint system well-documented
- [ ] Future contributors have context

---

### Task 5.3: Create Migration Guide

**File**: `MIGRATING-TO-v0.2.md` (new)

**Content**:
```markdown
# Migrating from v0.1.0 to v0.2.0

## Breaking Changes

None! v0.2.0 is fully backward compatible.

## New Features

1. **Memory Optimization**: Large historical syncs now possible
2. **Checkpoint/Resume**: Interrupted syncs resume automatically
3. **Multi-Chain Support**: Polygon, Arbitrum, Base fully tested

## Configuration Changes

Optional new fields in \`chaintap.yaml\`:

\`\`\`yaml
options:
  memory_options:
    max_heap_mb: 1024
    batch_commit_size: 10000

  checkpoint:
    enabled: true
    interval_blocks: 10000
\`\`\`

## Recommended Actions

1. Test memory-intensive syncs with new limits
2. Enable checkpoints for long-running backfills
3. Update chain configurations to use defaults
```

**Acceptance Criteria**:
- [ ] Clear migration path
- [ ] No breaking changes documented
- [ ] Examples provided

---

### Task 5.4: Update PRE-LAUNCH-CHECKLIST.md

**Updates**:
```markdown
## v0.2.0 Release Checklist

### Testing
- [ ] Memory profile tests passing
- [ ] Multi-chain integration tests passing
- [ ] Crash recovery tests passing
- [ ] Regression tests passing (all 155+ tests)
- [ ] 24-hour stability test on Ethereum

### Memory Optimization
- [ ] 10M block backfill completed with <1 GB RAM
- [ ] No memory leaks detected
- [ ] LRU cache working correctly
- [ ] Batch commits functioning

### Multi-Chain
- [ ] Polygon: 100K blocks indexed
- [ ] Arbitrum: 100K blocks indexed
- [ ] Base: 100K blocks indexed
- [ ] All events decoded correctly

### Checkpoint/Resume
- [ ] Checkpoints saving every 10K blocks
- [ ] Resume within 1K blocks of crash
- [ ] No data loss on interruption
- [ ] Works across process restarts

### Documentation
- [ ] README updated with memory requirements
- [ ] CLAUDE.md updated with architecture
- [ ] MIGRATING-TO-v0.2.md created
- [ ] CHANGELOG.md updated

### Performance
- [ ] Throughput maintained (10K+ blocks/min)
- [ ] Watch mode memory <256 MB
- [ ] No regression from v0.1.0
```

---

## Risk Management

### Critical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Streaming breaks existing API** | High | Medium | Keep backward-compatible wrapper, extensive testing |
| **LRU cache causes memory issues** | High | Low | Conservative limits, monitoring, fallback to Map |
| **Checkpoint corruption** | Medium | Low | Atomic writes, validation on load, tests |
| **Multi-chain APIs differ** | Medium | High | Per-chain configuration, manual testing |
| **Performance regression** | Medium | Medium | Benchmark before/after, load tests |

### Medium Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Batch size tuning needed** | Low | High | Make configurable, document tuning |
| **GC hints ineffective** | Low | Medium | Optional feature, document limitations |
| **Chain-specific quirks** | Medium | Medium | Extensive multi-chain testing |
| **Rate limiting too strict** | Low | Low | Configurable delays, backoff |

---

## Implementation Timeline

### Week 1: Memory Optimization (Core)
- Day 1-2: Streaming event fetcher
- Day 3: LRU cache integration
- Day 4: Batch commits
- Day 5: Integration and testing

### Week 2: Multi-Chain & Checkpoints
- Day 1-2: Etherscan V2 migration
- Day 3: Multi-chain integration tests
- Day 4-5: Checkpoint implementation

### Week 3: Testing & Documentation
- Day 1-2: Memory profile tests
- Day 3: Crash recovery tests
- Day 4: Multi-chain live tests
- Day 5: Documentation updates

### Week 4: Validation & Release
- Day 1-2: Extended testing (24+ hours)
- Day 3: Performance validation
- Day 4: Documentation review
- Day 5: Release prep and v0.2.0 publish

**Total Estimate**: 4 weeks (20 working days)

---

## Dependencies & Prerequisites

### New Dependencies
- `lru-cache`: LRU cache implementation
- `p-limit`: Rate limiting (already have p-retry)

### Development Tools
- Memory profiling tools
- Load testing scripts
- Multi-chain RPC access

### Infrastructure
- CI/CD pipeline for memory tests
- Test RPC endpoints for each chain
- Monitoring for long-running tests

---

## Definition of Done

### Code Complete
- [ ] All tasks implemented
- [ ] Code reviewed
- [ ] Tests passing (unit + integration)
- [ ] No linting errors
- [ ] Documentation updated

### Testing Complete
- [ ] Memory profile tests passing
- [ ] 10M block backfill completed
- [ ] Multi-chain tests passing (3 chains)
- [ ] Crash recovery validated
- [ ] 24-hour stability test passed

### Documentation Complete
- [ ] README.md updated
- [ ] CLAUDE.md updated
- [ ] Migration guide created
- [ ] CHANGELOG.md written
- [ ] Release notes drafted

### Ready for Release
- [ ] Version bumped to 0.2.0
- [ ] Git tag created
- [ ] npm package published
- [ ] GitHub release created
- [ ] Announcement prepared

---

## Post-Release Monitoring

### Week 1
- Monitor GitHub issues for bug reports
- Watch npm download metrics
- Check for memory-related issues
- Validate multi-chain usage

### Week 2-4
- Collect user feedback
- Performance monitoring
- Plan v0.3.0 improvements

---

## Future Considerations (v0.3.0+)

**Not in scope for v0.2.0**:

1. **True Streaming Architecture**: Complete rewrite for unlimited scaling
2. **Parallel Backfilling**: Multiple contracts in parallel
3. **Database Sharding**: Split large databases
4. **GraphQL API**: Query layer (out of scope)
5. **Cloud Deployment**: Docker/Kubernetes guides
6. **Advanced Monitoring**: Prometheus/Grafana integration

---

**Plan Version**: 1.0
**Created**: 2026-01-20
**Status**: Ready for Implementation
**Estimated Effort**: 4 weeks (20 days)
**Priority**: High (addresses critical production issues)
