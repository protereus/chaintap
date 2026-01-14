#!/bin/bash

# Start extended testing in tmux with monitoring
# Creates a tmux session with multiple windows for easy monitoring

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd "$PROJECT_DIR"

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}ChainTap Extended Testing - tmux Mode${NC}"
echo -e "${BLUE}=====================================${NC}"
echo ""

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
    set -a  # Export all variables
    source "$PROJECT_DIR/.env"
    set +a
    echo -e "${GREEN}✓ Loaded .env file${NC}"
else
    echo -e "${YELLOW}⚠ No .env file found${NC}"
    echo "  Create one with: echo 'ALCHEMY_URL=your_url' > .env"
fi

# Check ALCHEMY_URL
if [ -z "$ALCHEMY_URL" ]; then
    echo -e "\n${RED}Error: ALCHEMY_URL not set${NC}"
    exit 1
fi

echo -e "${GREEN}✓ ALCHEMY_URL configured${NC}"
echo ""

# Check if tmux session already exists
if tmux has-session -t chaintap-test 2>/dev/null; then
    echo -e "${YELLOW}tmux session 'chaintap-test' already exists${NC}"
    echo "Options:"
    echo "  1. Attach: tmux attach -t chaintap-test"
    echo "  2. Kill and restart: tmux kill-session -t chaintap-test && $0"
    exit 0
fi

# Create directories
mkdir -p "$PROJECT_DIR/pids"
mkdir -p "$PROJECT_DIR/logs"

# Create tmux session
echo "Creating tmux session 'chaintap-test'..."
tmux new-session -d -s chaintap-test -n "Watch-Mode" -c "$PROJECT_DIR"

# Window 0: Watch Mode
tmux send-keys -t chaintap-test:0 "cd $PROJECT_DIR" C-m
tmux send-keys -t chaintap-test:0 "set -a; source .env; set +a" C-m
tmux send-keys -t chaintap-test:0 "echo '=== Extended Watch Mode Test ===' && echo ''" C-m
tmux send-keys -t chaintap-test:0 "echo 'Starting watch mode for UNI + USDC...' && sleep 2" C-m
tmux send-keys -t chaintap-test:0 "node dist/cli/index.js watch --config test-configs/ethereum-watch-extended.yaml --verbose 2>&1 | tee logs/ethereum-watch.log" C-m

# Window 1: Load Test
tmux new-window -t chaintap-test:1 -n "Load-Test" -c "$PROJECT_DIR"
tmux send-keys -t chaintap-test:1 "cd $PROJECT_DIR" C-m
tmux send-keys -t chaintap-test:1 "set -a; source .env; set +a" C-m
tmux send-keys -t chaintap-test:1 "echo '=== Load Test (2M blocks) ===' && echo ''" C-m
tmux send-keys -t chaintap-test:1 "echo 'Getting current block number...' && sleep 2" C-m
tmux send-keys -t chaintap-test:1 "CURRENT_BLOCK=\$(curl -s -X POST -H 'Content-Type: application/json' --data '{\"jsonrpc\":\"2.0\",\"method\":\"eth_blockNumber\",\"params\":[],\"id\":1}' \"\$ALCHEMY_URL\" | grep -o '\"result\":\"[^\"]*\"' | cut -d'\"' -f4)" C-m
tmux send-keys -t chaintap-test:1 "CURRENT_BLOCK_DEC=\$((CURRENT_BLOCK))" C-m
tmux send-keys -t chaintap-test:1 "echo \"Starting load test: 17,000,000 -> \$CURRENT_BLOCK_DEC\" && echo ''" C-m
tmux send-keys -t chaintap-test:1 "sleep 3" C-m
tmux send-keys -t chaintap-test:1 "node dist/cli/index.js backfill --config test-configs/ethereum-load-test.yaml --from-block 17000000 --to-block \$CURRENT_BLOCK_DEC --verbose 2>&1 | tee logs/ethereum-load.log" C-m

# Window 2: Multi-Chain Tests
tmux new-window -t chaintap-test:2 -n "Multi-Chain" -c "$PROJECT_DIR"
tmux send-keys -t chaintap-test:2 "cd $PROJECT_DIR" C-m
tmux send-keys -t chaintap-test:2 "set -a; source .env; set +a" C-m
tmux send-keys -t chaintap-test:2 "echo '=== Multi-Chain Tests ===' && echo ''" C-m
tmux send-keys -t chaintap-test:2 "echo 'Waiting 10 seconds for other tests to start...' && sleep 10" C-m
tmux send-keys -t chaintap-test:2 "echo ''" C-m
tmux send-keys -t chaintap-test:2 "echo '[1/3] Testing Polygon...' && echo ''" C-m
tmux send-keys -t chaintap-test:2 "node dist/cli/index.js backfill --config test-configs/polygon-test.yaml --from-block 50000000 --to-block 50010000 --verbose 2>&1 | tee logs/polygon-test.log" C-m
tmux send-keys -t chaintap-test:2 "echo '' && echo '[2/3] Testing Arbitrum...' && echo ''" C-m
tmux send-keys -t chaintap-test:2 "node dist/cli/index.js backfill --config test-configs/arbitrum-test.yaml --from-block 180000000 --to-block 180010000 --verbose 2>&1 | tee logs/arbitrum-test.log" C-m
tmux send-keys -t chaintap-test:2 "echo '' && echo '[3/3] Testing Base...' && echo ''" C-m
tmux send-keys -t chaintap-test:2 "node dist/cli/index.js backfill --config test-configs/base-test.yaml --from-block 10000000 --to-block 10010000 --verbose 2>&1 | tee logs/base-test.log" C-m
tmux send-keys -t chaintap-test:2 "echo '' && echo 'Multi-chain tests complete!' && echo 'Check logs/ directory for results'" C-m

# Window 3: Monitor Dashboard
tmux new-window -t chaintap-test:3 -n "Monitor" -c "$PROJECT_DIR"
tmux send-keys -t chaintap-test:3 "cd $PROJECT_DIR" C-m
tmux send-keys -t chaintap-test:3 "echo 'Starting monitoring dashboard in 15 seconds...' && sleep 15" C-m
tmux send-keys -t chaintap-test:3 "./test-scripts/monitor-tests.sh" C-m

# Window 4: Logs
tmux new-window -t chaintap-test:4 -n "Logs" -c "$PROJECT_DIR"
tmux send-keys -t chaintap-test:4 "cd $PROJECT_DIR" C-m
tmux send-keys -t chaintap-test:4 "echo '=== Log Viewer ===' && echo ''" C-m
tmux send-keys -t chaintap-test:4 "echo 'Available log files:' && ls -lh logs/*.log 2>/dev/null || echo 'No logs yet (tests starting...)'" C-m
tmux send-keys -t chaintap-test:4 "echo ''" C-m
tmux send-keys -t chaintap-test:4 "echo 'Commands:'" C-m
tmux send-keys -t chaintap-test:4 "echo '  tail -f logs/ethereum-watch.log    # Watch mode'" C-m
tmux send-keys -t chaintap-test:4 "echo '  tail -f logs/ethereum-load.log     # Load test'" C-m
tmux send-keys -t chaintap-test:4 "echo '  tail -f logs/polygon-test.log      # Polygon'" C-m
tmux send-keys -t chaintap-test:4 "echo '  tail -f logs/arbitrum-test.log     # Arbitrum'" C-m
tmux send-keys -t chaintap-test:4 "echo '  tail -f logs/base-test.log         # Base'" C-m
tmux send-keys -t chaintap-test:4 "echo '  grep -i error logs/*.log           # Find errors'" C-m

# Window 5: Commands
tmux new-window -t chaintap-test:5 -n "Commands" -c "$PROJECT_DIR"
tmux send-keys -t chaintap-test:5 "cd $PROJECT_DIR" C-m
tmux send-keys -t chaintap-test:5 "cat << 'EOF'

========================================
ChainTap Extended Testing - Quick Guide
========================================

TMUX Navigation:
  Ctrl+b n     - Next window
  Ctrl+b p     - Previous window
  Ctrl+b 0-5   - Jump to window number
  Ctrl+b d     - Detach from session
  Ctrl+b ?     - Help (show all keybindings)

Windows:
  0: Watch-Mode  - 24hr stability test (UNI + USDC)
  1: Load-Test   - 2M block backfill (17M -> current)
  2: Multi-Chain - Polygon, Arbitrum, Base tests
  3: Monitor     - Live dashboard (auto-refresh)
  4: Logs        - Log file viewer
  5: Commands    - This help screen (you are here)

Useful Commands:
  # Check test status
  ./test-scripts/monitor-tests.sh summary

  # Query databases
  sqlite3 extended-test-ethereum.db \"SELECT COUNT(*) FROM events;\"
  sqlite3 load-test-ethereum.db \"SELECT COUNT(*) FROM events;\"

  # Check memory usage
  ps aux | grep chaintap

  # Stop all tests
  ./test-scripts/stop-tests.sh

  # View logs
  tail -f logs/ethereum-watch.log

  # Check for errors
  grep -i error logs/*.log | tail -20

Detaching and Reattaching:
  Ctrl+b d         - Detach (tests keep running)
  tmux attach -t chaintap-test  - Reattach later

Expected Timeline:
  - Multi-Chain tests: ~30 minutes
  - Load test: ~12-48 hours
  - Watch mode: Run for 24+ hours

Success Criteria:
  ✓ Watch mode runs 24+ hours without crash
  ✓ Memory stays < 256MB
  ✓ Load test completes 1M+ blocks
  ✓ All 3 chains work correctly

========================================

Press Enter for interactive shell...

EOF" C-m

# Select Monitor window by default
tmux select-window -t chaintap-test:3

echo ""
echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}tmux session created successfully!${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo "Session: chaintap-test"
echo ""
echo "Windows:"
echo "  0: Watch-Mode  - Extended watch test (24+ hours)"
echo "  1: Load-Test   - Historical backfill (2M blocks)"
echo "  2: Multi-Chain - Polygon, Arbitrum, Base"
echo "  3: Monitor     - Live dashboard (starting view)"
echo "  4: Logs        - Log viewer"
echo "  5: Commands    - Quick reference guide"
echo ""
echo "To attach:"
echo -e "  ${YELLOW}tmux attach -t chaintap-test${NC}"
echo ""
echo "To detach (keeps tests running):"
echo "  Press: Ctrl+b then d"
echo ""
echo "To kill session:"
echo "  tmux kill-session -t chaintap-test"
echo ""
echo -e "${BLUE}Attaching to session now...${NC}"
sleep 2

# Attach to the session
tmux attach -t chaintap-test
