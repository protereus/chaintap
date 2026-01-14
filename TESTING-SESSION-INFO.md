# ChainTap Extended Testing - Active Session

**Status**: 🟢 TESTS RUNNING
**Started**: 2026-01-14 16:37:56 UTC
**Session**: `chaintap-test`

---

## Quick Access

```bash
# Attach to testing session
tmux attach -t chaintap-test

# View monitoring dashboard
tmux attach -t chaintap-test
# Then press: Ctrl+b 3  (switch to Monitor window)

# Detach (keeps tests running)
# Press: Ctrl+b d
```

---

## Test Status

### ✅ Test 1: Extended Watch Mode (24+ Hours)
- **Status**: Running, waiting for new blocks
- **Current Block**: 24,234,184
- **Contracts**: UNI Token, USDC
- **Mode**: Real-time indexing
- **Log**: `logs/ethereum-watch.log`
- **Database**: `extended-test-ethereum.db`

### 🔄 Test 2: Load Test (2M Blocks)
- **Status**: Running, actively indexing
- **Progress**: Block 17,016,009 / 24,234,184 (2.4% complete)
- **Blocks Remaining**: ~7.2M blocks
- **Estimated Time**: 12-48 hours
- **Log**: `logs/ethereum-load.log`
- **Database**: `load-test-ethereum.db`

### ⏳ Test 3: Multi-Chain Tests
- **Status**: Queued (starts after ~10 seconds)
- **Chains**: Polygon, Arbitrum, Base
- **Logs**: `logs/*-test.log`

---

## tmux Windows

| # | Name | Purpose | Status |
|---|------|---------|--------|
| 0 | Watch-Mode | 24hr stability test | ✅ Running |
| 1 | Load-Test | Historical backfill | ✅ Running |
| 2 | Multi-Chain | Chain compatibility tests | ⏳ Starting |
| 3 | Monitor | Live dashboard | ✅ Active |
| 4 | Logs | Log viewer | ℹ️ Ready |
| 5 | Commands | Quick reference | ℹ️ Ready |

---

## Monitoring Commands

### Check Progress

```bash
# Quick summary
./test-scripts/monitor-tests.sh summary

# Live dashboard (auto-refresh every 30s)
./test-scripts/monitor-tests.sh

# Check load test progress
sqlite3 load-test-ethereum.db "SELECT COUNT(*) FROM events;"

# Check watch mode events
sqlite3 extended-test-ethereum.db "SELECT COUNT(*) FROM events;"

# View logs
tail -f logs/ethereum-load.log
tail -f logs/ethereum-watch.log
```

### Check Memory Usage

```bash
# Monitor memory over time
watch -n 60 'ps aux | grep "node.*chaintap" | grep -v grep'

# Check specific process
ps -o pid,rss,cmd -C node | grep chaintap
```

### Check Database Growth

```bash
# Database sizes
ls -lh *.db

# Event counts
for db in *.db; do
  echo "$db: $(sqlite3 "$db" "SELECT COUNT(*) FROM events;" 2>/dev/null || echo "0") events"
done
```

---

## Expected Timeline

| Milestone | Expected Time | Status |
|-----------|--------------|---------|
| Multi-chain tests complete | ~30 minutes | ⏳ Pending |
| Load test 10% (720K blocks) | ~3-6 hours | ⏳ Pending |
| Load test 50% (3.6M blocks) | ~12-24 hours | ⏳ Pending |
| Load test 100% (7.2M blocks) | ~24-48 hours | ⏳ Pending |
| Watch mode 24 hours | 24 hours | ⏳ Pending |

---

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
- [ ] Query performance acceptable (<500ms for range queries)
- [ ] Memory usage remains stable
- [ ] No crashes or data corruption
- [ ] Throughput: > 100 blocks/minute

### Test 3: Multi-Chain ✓
- [ ] Polygon: Indexes 10K blocks successfully
- [ ] Arbitrum: Indexes 10K blocks successfully
- [ ] Base: Indexes 10K blocks successfully
- [ ] All chains: Proper event decoding
- [ ] No chain-specific bugs

---

## Troubleshooting

### Tests Stopped Running

```bash
# Check if session exists
tmux list-sessions

# Check logs for errors
grep -i "error\|fail\|exception" logs/*.log | tail -20

# Restart tests
./test-scripts/start-tmux-testing.sh
```

### High Memory Usage

```bash
# Check memory
ps aux | grep node | grep chaintap

# If > 256MB, this is a potential memory leak
# Document in test report
```

### Database Issues

```bash
# Check database integrity
sqlite3 load-test-ethereum.db "PRAGMA integrity_check;"

# Check for locks
lsof *.db
```

---

## Stopping Tests

```bash
# Stop all tests gracefully
./test-scripts/stop-tests.sh

# Or kill tmux session
tmux kill-session -t chaintap-test

# Or from within tmux
# Press: Ctrl+b :
# Type: kill-session
# Press: Enter
```

---

## Files & Locations

**Environment**:
- `.env` - API keys (gitignored, secure)

**Logs** (auto-created):
- `logs/ethereum-watch.log` - Watch mode output
- `logs/ethereum-load.log` - Load test output
- `logs/polygon-test.log` - Polygon test
- `logs/arbitrum-test.log` - Arbitrum test
- `logs/base-test.log` - Base test

**Databases** (auto-created):
- `extended-test-ethereum.db` - Watch mode events
- `load-test-ethereum.db` - Load test events
- `test-polygon.db` - Polygon events
- `test-arbitrum.db` - Arbitrum events
- `test-base.db` - Base events

**Process IDs**:
- `pids/ethereum-watch.pid` - Watch mode PID
- `pids/ethereum-load.pid` - Load test PID

---

## tmux Cheat Sheet

| Command | Action |
|---------|--------|
| `Ctrl+b n` | Next window |
| `Ctrl+b p` | Previous window |
| `Ctrl+b 0-5` | Jump to window number |
| `Ctrl+b d` | Detach (tests keep running) |
| `Ctrl+b c` | Create new window |
| `Ctrl+b ,` | Rename window |
| `Ctrl+b ?` | Show all keybindings |
| `Ctrl+b [` | Scroll mode (q to exit) |

---

## After Testing Completes

1. **Stop tests**: `./test-scripts/stop-tests.sh`
2. **Generate summary**: `./test-scripts/monitor-tests.sh summary > results.txt`
3. **Document results**: Fill out `EXTENDED-TEST-REPORT-TEMPLATE.md`
4. **Commit results**: `git add EXTENDED-TEST-REPORT.md && git commit -m "docs: add extended test results"`
5. **Update checklist**: Mark items in `PRE-LAUNCH-CHECKLIST.md` as complete
6. **Decide next step**: Proceed with stable v0.1.0 release or fix issues

---

**Last Updated**: 2026-01-14 16:38:00 UTC
**Test Session**: chaintap-test (running)
**Monitor**: `tmux attach -t chaintap-test`
