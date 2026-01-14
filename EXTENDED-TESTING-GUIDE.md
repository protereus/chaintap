# ChainTap Extended Testing Guide

**Status**: Testing infrastructure complete and validated ✅
**Quick Validation**: All checks passed (155 unit tests, smoke test successful)
**Ready**: Awaiting API keys and extended test execution

---

## Overview

This guide covers the extended testing phase for ChainTap MVP before stable v0.1.0 release. All testing infrastructure has been created, validated, and is ready to execute.

### What's Been Done

✅ **Testing infrastructure created**:
- 5 test configurations (Ethereum watch + load + 3 chains)
- 4 automated test scripts (run, monitor, stop, validate)
- Complete monitoring dashboard
- Test report template

✅ **Quick validation passed**:
- Build verification ✓
- 155 unit tests passing ✓
- Smoke test on public RPC ✓ (indexed 1 event from blocks 19M-19M+10)
- CLI commands working ✓

✅ **Security verified**:
- All configs use environment variables
- No exposed API keys
- .npmignore configured

---

## Test Plan

### Test 1: Extended Watch Mode (24+ Hours)

**Purpose**: Long-term stability, memory leak detection, real-time indexing validation

**What It Tests**:
- Memory stability over 24+ hours
- No memory leaks (memory should stay ~same)
- Real-time indexing with < 30s latency
- Graceful handling of RPC failures
- Provider failover functionality
- Resumability after interruptions

**Configuration**:
- Contracts: UNI Token + USDC on Ethereum
- Mode: Real-time watch
- Poll interval: 15 seconds
- Confirmations: 12 blocks

**Expected Results**:
- Process runs continuously for 24+ hours
- Memory stays < 256MB throughout
- Events indexed within 30 seconds of block confirmation
- No crashes or data corruption

### Test 2: Load Test (1M+ Blocks)

**Purpose**: Database scalability, query performance, historical sync throughput

**What It Tests**:
- Historical sync of ~2M blocks (17M → current)
- Database growth (should be linear)
- Query performance with large datasets
- Memory stability during heavy indexing
- Throughput measurement

**Configuration**:
- Contract: UNI Token on Ethereum
- Block range: 17,000,000 → current (~2M blocks)
- Mode: Historical backfill
- Batch size: 10 (Alchemy free tier limit)

**Expected Results**:
- Successfully indexes 1M+ blocks
- Database grows linearly (~10KB per 1000 events)
- Throughput > 100 blocks/min (with free tier)
- Queries remain fast (<500ms for range queries)
- Memory stays stable

### Test 3: Multi-Chain Support

**Purpose**: Verify EVM compatibility across different chains

**What It Tests**:
- Polygon RPC compatibility
- Arbitrum RPC compatibility
- Base RPC compatibility
- Chain-specific block explorer API (if using auto-ABI)
- Event decoding consistency

**Configuration**:
- Each chain: 10,000 block test
- Contract: USDC on each chain
- Public RPCs used

**Expected Results**:
- All 3 chains index successfully
- Event decoding works correctly
- No chain-specific bugs

---

## How to Run Extended Tests

### Prerequisites

1. **Alchemy API Key** (required for Tests 1 & 2):
   ```bash
   export ALCHEMY_URL='https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY'
   ```

   Get a free key at: https://www.alchemy.com/

2. **Etherscan API Key** (optional, for auto-ABI):
   ```bash
   export ETHERSCAN_API_KEY='YOUR_API_KEY'
   ```

3. **Build the project**:
   ```bash
   npm run build
   ```

### Quick Validation (Run This First)

Before starting extended tests, verify everything works:

```bash
./test-scripts/quick-validation.sh
```

This runs:
- Build check
- Node.js version check
- All 155 unit tests
- Quick smoke test (indexes 11 blocks)

Should complete in < 60 seconds and show all green checkmarks.

### Start Extended Tests

**Option A: Run All Tests Automatically** (Recommended)

```bash
# Start all tests in background
./test-scripts/run-extended-tests.sh

# This will:
# 1. Start 24+ hour watch mode (background)
# 2. Start load test for ~2M blocks (background)
# 3. Run multi-chain tests (sequential: Polygon → Arbitrum → Base)
```

**Option B: Run Tests Individually**

See `test-configs/README.md` for manual test commands.

### Monitor Tests

**Live Dashboard** (refreshes every 30 seconds):
```bash
./test-scripts/monitor-tests.sh
```

Shows:
- Process status (running/stopped)
- Uptime and memory usage
- Event counts and block ranges
- Database sizes
- System resources

**One-Time Summary**:
```bash
./test-scripts/monitor-tests.sh summary
```

**Check Logs**:
```bash
# Watch mode logs
tail -f logs/ethereum-watch.log

# Load test logs
tail -f logs/ethereum-load.log

# Multi-chain logs
tail -f logs/polygon-test.log
tail -f logs/arbitrum-test.log
tail -f logs/base-test.log
```

### Stop Tests

```bash
./test-scripts/stop-tests.sh
```

Stops watch mode and load test (multi-chain tests complete automatically).

---

## What to Monitor

### Memory Usage

**Goal**: Memory should stay < 256MB and remain stable

```bash
# Check periodically
ps aux | grep chaintap

# Watch memory over time
watch -n 60 'ps -o pid,rss,cmd -p $(cat pids/ethereum-watch.pid)'
```

**Red Flags**:
- Memory consistently increasing over hours (memory leak)
- Memory spikes > 256MB
- Process killed by OOM

### Event Indexing

**Goal**: Events indexed consistently without gaps

```bash
# Check event counts
sqlite3 extended-test-ethereum.db "
  SELECT
    contract_address,
    COUNT(*) as events,
    MIN(block_number) as first_block,
    MAX(block_number) as last_block
  FROM events
  GROUP BY contract_address;
"
```

**Red Flags**:
- Block gaps in indexed range
- Events suddenly stop appearing
- Duplicate events (should be prevented by UNIQUE constraint)

### Errors

**Goal**: No errors or all errors handled gracefully

```bash
# Check for errors
grep -i "error\|fail\|exception" logs/*.log | wc -l

# Check error types
grep -i "error" logs/*.log | tail -20
```

**Acceptable Errors**:
- Occasional RPC timeout (should retry)
- Rate limit errors (should failover to backup provider)

**Red Flags**:
- Database locked errors
- Unhandled exceptions
- Crashes/restarts

### Performance

**Goal**: Throughput > 100 blocks/min for load test

```bash
# Watch load test progress
watch -n 10 './test-scripts/monitor-tests.sh summary | grep "Load Test"'
```

**Calculate throughput**:
```
Throughput = (End Block - Start Block) / (Duration in minutes)
```

With Alchemy free tier (10-block limit): ~100-500 blocks/min expected
With paid tier (2000-block limit): 10,000+ blocks/min expected

---

## Expected Duration

| Test | Duration | Notes |
|------|----------|-------|
| Quick Validation | ~60 seconds | Must complete before extended tests |
| Multi-Chain Tests | ~15-30 minutes | 30K blocks across 3 chains |
| Load Test | ~12-48 hours | Depends on RPC tier and event volume |
| Watch Mode | 24+ hours continuous | Leave running to test stability |

**Total time for complete extended testing**: ~2-3 days

---

## After Testing Completes

### 1. Stop All Tests

```bash
./test-scripts/stop-tests.sh
```

### 2. Generate Summary

```bash
./test-scripts/monitor-tests.sh summary > test-results-summary.txt
```

### 3. Analyze Results

Check for:
- ✅ All tests completed without crashes
- ✅ Memory stayed < 256MB
- ✅ No memory leaks (memory stable over time)
- ✅ Database queries fast (<500ms)
- ✅ No data corruption
- ✅ All 3 chains work

### 4. Document Results

Fill out `EXTENDED-TEST-REPORT-TEMPLATE.md` with:
- Actual metrics from monitoring
- Issues encountered (if any)
- Performance measurements
- Final pass/fail status

### 5. Commit Results

```bash
# Rename template with actual results
mv EXTENDED-TEST-REPORT-TEMPLATE.md EXTENDED-TEST-REPORT.md

# Edit file with results
# Then commit
git add EXTENDED-TEST-REPORT.md
git commit -m "docs: add extended test results"
```

### 6. Update Pre-Launch Checklist

```bash
# Update PRE-LAUNCH-CHECKLIST.md
# Mark extended testing items as complete
```

---

## Troubleshooting

### "ALCHEMY_URL environment variable not set"

**Fix**:
```bash
export ALCHEMY_URL='https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY'
```

Make it permanent:
```bash
echo 'export ALCHEMY_URL="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"' >> ~/.bashrc
source ~/.bashrc
```

### Rate Limit Errors

**Symptoms**: Logs show "429" or "rate limit exceeded"

**Fix**:
- Using Alchemy free tier: Expected, tests will auto-retry
- Persistent issues: Upgrade to paid tier or add more backup providers

### Memory Growing Over Time

**Symptoms**: Memory usage increases hour over hour

**Action**:
1. Stop the test immediately
2. Check logs for specific memory leak patterns
3. This is a critical bug - document and file issue
4. Fix required before stable release

### Database Locked

**Symptoms**: "database is locked" errors

**Fix**:
- Check for multiple processes accessing same DB
- Verify WAL mode is enabled (should be automatic)
- Ensure proper cleanup of connections

### Process Crashes

**Symptoms**: PID file exists but process is dead

**Action**:
1. Check logs for error before crash
2. Check system resources (out of memory? disk full?)
3. Document crash details
4. This is a critical bug if reproducible

---

## Test Checklist

Before starting:
- [ ] Quick validation passes (`./test-scripts/quick-validation.sh`)
- [ ] ALCHEMY_URL environment variable set
- [ ] Enough disk space (>10GB recommended)
- [ ] Stable internet connection
- [ ] System can run 24+ hours uninterrupted

During testing:
- [ ] Monitor memory usage every few hours
- [ ] Check for errors in logs
- [ ] Verify events being indexed
- [ ] Monitor system resources

After testing:
- [ ] All tests completed or documented why not
- [ ] Results documented in EXTENDED-TEST-REPORT.md
- [ ] Any bugs filed as GitHub issues
- [ ] PRE-LAUNCH-CHECKLIST.md updated
- [ ] Decision made: proceed with release or fix issues first

---

## Next Steps After Extended Testing

**If all tests pass**:
1. Update PRE-LAUNCH-CHECKLIST.md (mark items complete)
2. Create EXTENDED-TEST-REPORT.md with results
3. Commit and push test results
4. **Proceed with stable v0.1.0 npm release**

**If tests fail or issues found**:
1. Document all issues in GitHub Issues
2. Fix critical bugs
3. Re-run failed tests
4. Continue iteration until all tests pass

**If tests partially pass**:
1. Document known limitations in README.md
2. Consider beta release (`npm publish --tag beta`)
3. Get community feedback
4. Fix issues and promote to stable later

---

## Files Reference

```
test-configs/
├── README.md                      # Detailed testing guide
├── ethereum-watch-extended.yaml   # 24hr stability test
├── ethereum-load-test.yaml        # 2M block load test
├── polygon-test.yaml              # Polygon 10K blocks
├── arbitrum-test.yaml             # Arbitrum 10K blocks
└── base-test.yaml                 # Base 10K blocks

test-scripts/
├── run-extended-tests.sh          # Start all tests
├── monitor-tests.sh               # Live dashboard
├── stop-tests.sh                  # Stop running tests
└── quick-validation.sh            # Pre-flight checks

EXTENDED-TEST-REPORT-TEMPLATE.md   # Report template
EXTENDED-TESTING-GUIDE.md          # This file
PRE-LAUNCH-CHECKLIST.md            # Overall launch checklist
```

---

**Status**: Infrastructure complete ✅
**Ready to execute**: Yes, pending API keys
**Estimated completion**: 2-3 days after starting

**To start testing**:
```bash
export ALCHEMY_URL='https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY'
./test-scripts/quick-validation.sh  # Verify first
./test-scripts/run-extended-tests.sh  # Start tests
./test-scripts/monitor-tests.sh  # Monitor
```
