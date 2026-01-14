# ChainTap Extended Testing

This directory contains configurations and scripts for extended MVP testing before stable release.

## Testing Goals

1. **Extended Watch Mode (24+ hours)** - Test long-term stability and memory leak detection
2. **Load Testing (1M+ blocks)** - Test database growth and query performance
3. **Multi-Chain Support** - Verify compatibility with Polygon, Arbitrum, and Base

## Prerequisites

### Environment Variables

Set your Alchemy API key:
```bash
export ALCHEMY_URL='https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY'
```

### Build the Project

```bash
cd /root/chaintap
npm run build
```

## Running Extended Tests

### Option 1: Run All Tests (Automated)

```bash
# Start all extended tests
./test-scripts/run-extended-tests.sh

# Monitor progress (live dashboard, refreshes every 30s)
./test-scripts/monitor-tests.sh

# Get one-time summary
./test-scripts/monitor-tests.sh summary

# Stop all tests
./test-scripts/stop-tests.sh
```

### Option 2: Run Individual Tests

#### Test 1: Extended Watch Mode (Ethereum)

**Duration**: 24+ hours (run continuously)
**Purpose**: Memory leak detection, long-term stability
**Contracts**: UNI Token, USDC

```bash
# Start watch mode
ALCHEMY_URL='your_key' node dist/cli/index.js watch \
  --config test-configs/ethereum-watch-extended.yaml \
  --verbose \
  > logs/ethereum-watch.log 2>&1 &

# Save PID
echo $! > pids/ethereum-watch.pid

# Monitor logs
tail -f logs/ethereum-watch.log

# Check memory usage periodically
ps aux | grep "node.*watch"

# Check database growth
watch -n 60 'sqlite3 extended-test-ethereum.db "SELECT COUNT(*) FROM events;"'
```

#### Test 2: Load Test (Ethereum)

**Block Range**: 17,000,000 to current (~2M blocks)
**Purpose**: Database growth, query performance, throughput measurement
**Contract**: UNI Token

```bash
# Get current block number
CURRENT_BLOCK=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  "$ALCHEMY_URL" | grep -o '"result":"[^"]*"' | cut -d'"' -f4)

CURRENT_BLOCK_DEC=$((CURRENT_BLOCK))

# Start load test
ALCHEMY_URL='your_key' node dist/cli/index.js backfill \
  --config test-configs/ethereum-load-test.yaml \
  --from-block 17000000 \
  --to-block $CURRENT_BLOCK_DEC \
  --verbose \
  > logs/ethereum-load.log 2>&1 &

# Save PID
echo $! > pids/ethereum-load.pid

# Monitor progress
tail -f logs/ethereum-load.log

# Check performance metrics
watch -n 10 './test-scripts/monitor-tests.sh summary'
```

#### Test 3: Multi-Chain Tests

**Chains**: Polygon, Arbitrum, Base
**Block Range**: 10,000 blocks each
**Purpose**: Verify RPC compatibility and ABI fetching on different chains

```bash
# Polygon
node dist/cli/index.js backfill \
  --config test-configs/polygon-test.yaml \
  --from-block 50000000 \
  --to-block 50010000 \
  --verbose

# Arbitrum
node dist/cli/index.js backfill \
  --config test-configs/arbitrum-test.yaml \
  --from-block 180000000 \
  --to-block 180010000 \
  --verbose

# Base
node dist/cli/index.js backfill \
  --config test-configs/base-test.yaml \
  --from-block 10000000 \
  --to-block 10010000 \
  --verbose
```

## Test Configurations

### ethereum-watch-extended.yaml
- **Chain**: Ethereum Mainnet
- **Contracts**: UNI Token, USDC
- **Mode**: Watch (real-time)
- **From Block**: null (starts from current)
- **Confirmations**: 12
- **Poll Interval**: 15s

### ethereum-load-test.yaml
- **Chain**: Ethereum Mainnet
- **Contract**: UNI Token only
- **Mode**: Backfill (historical)
- **From Block**: 17,000,000
- **To Block**: Current (~2M blocks)
- **Confirmations**: 0 (historical data)

### polygon-test.yaml
- **Chain**: Polygon
- **Contract**: USDC (Polygon)
- **Block Range**: 50,000,000 - 50,010,000 (10K blocks)
- **Confirmations**: 128 (Polygon standard)

### arbitrum-test.yaml
- **Chain**: Arbitrum One
- **Contract**: USDC (Arbitrum)
- **Block Range**: 180,000,000 - 180,010,000 (10K blocks)
- **Confirmations**: 0

### base-test.yaml
- **Chain**: Base
- **Contract**: USDC (Base)
- **Block Range**: 10,000,000 - 10,010,000 (10K blocks)
- **Confirmations**: 0

## Monitoring

### Live Dashboard

```bash
./test-scripts/monitor-tests.sh
```

Shows:
- Process status (running/stopped)
- Uptime and memory usage
- Event counts per database
- Block ranges indexed
- Database sizes
- System resources

### Manual Monitoring

```bash
# Check running processes
ps aux | grep chaintap

# Check memory usage
ps -o pid,rss,cmd -p $(cat pids/ethereum-watch.pid)

# Check disk usage
du -sh *.db

# Query databases
sqlite3 extended-test-ethereum.db "
  SELECT
    contract_address,
    COUNT(*) as event_count,
    MIN(block_number) as min_block,
    MAX(block_number) as max_block
  FROM events
  GROUP BY contract_address;
"
```

## Success Criteria

### Test 1: Extended Watch Mode ✓

- [ ] Runs for 24+ hours without crashing
- [ ] Memory usage stays < 256MB
- [ ] No memory leaks (memory stable over time)
- [ ] Handles RPC failures gracefully
- [ ] Resumes after restarts
- [ ] Indexes events with < 30s latency

### Test 2: Load Test ✓

- [ ] Successfully indexes 1M+ blocks
- [ ] Database grows linearly (no exponential growth)
- [ ] Query performance acceptable:
  - Simple queries: < 100ms
  - Range queries: < 500ms
  - Aggregations: < 2s
- [ ] Memory usage remains stable
- [ ] No crashes or data corruption
- [ ] Throughput: > 100 blocks/minute with free tier

### Test 3: Multi-Chain ✓

- [ ] Polygon: Indexes 10K blocks successfully
- [ ] Arbitrum: Indexes 10K blocks successfully
- [ ] Base: Indexes 10K blocks successfully
- [ ] All chains: Proper event decoding
- [ ] All chains: Correct chainId in queries
- [ ] No chain-specific bugs

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Historical sync | 100+ blocks/min | With free RPC tier |
| Historical sync | 10,000+ blocks/min | With paid RPC tier |
| Live latency | < 30 seconds | From block mined to indexed |
| Memory usage | < 256 MB | Stable over 24+ hours |
| Database growth | ~10 KB per 1000 events | Linear growth |

## Troubleshooting

### High Memory Usage

```bash
# Check process memory
ps aux --sort=-%mem | grep chaintap

# Enable memory profiling
NODE_OPTIONS='--max-old-space-size=256' node dist/cli/index.js watch ...
```

### RPC Rate Limits

```bash
# Check logs for rate limit errors
grep "429\|rate limit" logs/*.log

# Add more providers to config
# Or increase poll_interval
```

### Database Locked Errors

```bash
# Check for multiple processes accessing same DB
lsof *.db

# Ensure WAL mode is enabled
sqlite3 test.db "PRAGMA journal_mode=WAL;"
```

### Process Crashes

```bash
# Check logs for errors
tail -100 logs/ethereum-watch.log

# Check system resources
free -h
df -h
```

## Analyzing Results

After testing completes, analyze the results:

```bash
# Generate summary report
./test-scripts/monitor-tests.sh summary > test-results.txt

# Database statistics
for db in *.db; do
  echo "=== $db ==="
  sqlite3 "$db" "
    SELECT
      COUNT(*) as total_events,
      COUNT(DISTINCT contract_address) as contracts,
      MIN(block_number) as first_block,
      MAX(block_number) as last_block,
      MAX(block_number) - MIN(block_number) + 1 as blocks_indexed
    FROM events;
  "
  echo ""
done

# Check for errors in logs
grep -i "error\|failed\|exception" logs/*.log | wc -l

# Memory leak check (compare memory usage over time)
grep "Memory:" logs/ethereum-watch.log | tail -20
```

## Cleanup

```bash
# Stop all tests
./test-scripts/stop-tests.sh

# Remove test databases (if needed)
rm -f extended-test-*.db test-*.db load-test-*.db

# Remove logs (if needed)
rm -f logs/*.log

# Remove PIDs
rm -f pids/*.pid
```

## Next Steps

After successful extended testing:

1. Document results in `EXTENDED-TEST-REPORT.md`
2. Update `PRE-LAUNCH-CHECKLIST.md` with test status
3. Fix any discovered bugs
4. Proceed with npm publish as stable v0.1.0

---

**Note**: These test configs use environment variables for API keys and public RPC endpoints for failover. Never commit files with hardcoded API keys!
