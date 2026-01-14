#!/bin/bash

# Extended Testing Runner for ChainTap MVP
# Runs all three test phases: watch mode, load test, multi-chain

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Create necessary directories
mkdir -p "$PROJECT_DIR/pids"
mkdir -p "$PROJECT_DIR/logs"

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}ChainTap Extended Testing Suite${NC}"
echo -e "${BLUE}=====================================${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if [ ! -f "$PROJECT_DIR/dist/cli/index.js" ]; then
    echo -e "${RED}Error: Build not found. Run 'npm run build' first${NC}"
    exit 1
fi

if [ -z "$ALCHEMY_URL" ]; then
    echo -e "${RED}Error: ALCHEMY_URL environment variable not set${NC}"
    echo "  Set it with: export ALCHEMY_URL='https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY'"
    exit 1
fi

echo -e "${GREEN}✓ Build found${NC}"
echo -e "${GREEN}✓ ALCHEMY_URL set${NC}"
echo ""

# Function to start a test
start_test() {
    local test_name=$1
    local config_file=$2
    local command=$3
    local pid_file=$4
    local log_file=$5

    echo -e "${BLUE}Starting: $test_name${NC}"
    echo "  Config: $config_file"
    echo "  Log: $log_file"

    # Start in background
    nohup node "$PROJECT_DIR/dist/cli/index.js" $command \
        --config "$config_file" \
        > "$log_file" 2>&1 &

    local pid=$!
    echo $pid > "$pid_file"

    echo -e "${GREEN}✓ Started (PID: $pid)${NC}"
    echo ""
}

# Test 1: Extended Watch Mode (24+ hours)
echo -e "${BLUE}=== Test 1: Extended Watch Mode ===${NC}"
echo "Duration: 24+ hours (run continuously)"
echo "Chains: Ethereum Mainnet"
echo "Contracts: UNI Token, USDC"
echo "Purpose: Memory leak detection, long-term stability"
echo ""

start_test \
    "Extended Watch Mode" \
    "$PROJECT_DIR/test-configs/ethereum-watch-extended.yaml" \
    "watch --verbose" \
    "$PROJECT_DIR/pids/ethereum-watch.pid" \
    "$PROJECT_DIR/logs/ethereum-watch.log"

# Test 2: Load Test (1M+ blocks)
echo -e "${BLUE}=== Test 2: Load Test ===${NC}"
echo "Block Range: 17,000,000 to current (~2M blocks)"
echo "Chain: Ethereum Mainnet"
echo "Contract: UNI Token"
echo "Purpose: Database growth, query performance, throughput"
echo ""

# Calculate target block
CURRENT_BLOCK=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    "$ALCHEMY_URL" | grep -o '"result":"[^"]*"' | cut -d'"' -f4)

CURRENT_BLOCK_DEC=$((CURRENT_BLOCK))

echo "Current block: $CURRENT_BLOCK_DEC"
echo "Target: Index ~2M blocks from block 17,000,000"
echo ""

start_test \
    "Load Test" \
    "$PROJECT_DIR/test-configs/ethereum-load-test.yaml" \
    "backfill --from-block 17000000 --to-block $CURRENT_BLOCK_DEC --verbose" \
    "$PROJECT_DIR/pids/ethereum-load.pid" \
    "$PROJECT_DIR/logs/ethereum-load.log"

# Give the processes a moment to start
sleep 5

echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}Extended tests started!${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo "Running tests:"
echo "  [1] Watch Mode: Extended monitoring (24+ hours)"
echo "  [2] Load Test: Historical backfill (~2M blocks)"
echo ""
echo "Monitor progress:"
echo "  ${YELLOW}$SCRIPT_DIR/monitor-tests.sh${NC}  # Live dashboard"
echo ""
echo "Check logs:"
echo "  ${YELLOW}tail -f $PROJECT_DIR/logs/ethereum-watch.log${NC}"
echo "  ${YELLOW}tail -f $PROJECT_DIR/logs/ethereum-load.log${NC}"
echo ""
echo "Stop tests:"
echo "  ${YELLOW}$SCRIPT_DIR/stop-tests.sh${NC}"
echo ""
echo -e "${BLUE}Now starting multi-chain tests...${NC}"
echo ""

# Test 3: Multi-Chain Tests (run sequentially for small block ranges)
echo -e "${BLUE}=== Test 3: Multi-Chain Tests ===${NC}"
echo "Testing Polygon, Arbitrum, and Base"
echo "Block range: 10,000 blocks each"
echo ""

# Polygon test
echo -e "${YELLOW}[Polygon] Starting...${NC}"
node "$PROJECT_DIR/dist/cli/index.js" backfill \
    --config "$PROJECT_DIR/test-configs/polygon-test.yaml" \
    --from-block 50000000 \
    --to-block 50010000 \
    --verbose \
    > "$PROJECT_DIR/logs/polygon-test.log" 2>&1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Polygon test completed${NC}"
else
    echo -e "${RED}✗ Polygon test failed (check logs)${NC}"
fi
echo ""

# Arbitrum test
echo -e "${YELLOW}[Arbitrum] Starting...${NC}"
node "$PROJECT_DIR/dist/cli/index.js" backfill \
    --config "$PROJECT_DIR/test-configs/arbitrum-test.yaml" \
    --from-block 180000000 \
    --to-block 180010000 \
    --verbose \
    > "$PROJECT_DIR/logs/arbitrum-test.log" 2>&1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Arbitrum test completed${NC}"
else
    echo -e "${RED}✗ Arbitrum test failed (check logs)${NC}"
fi
echo ""

# Base test
echo -e "${YELLOW}[Base] Starting...${NC}"
node "$PROJECT_DIR/dist/cli/index.js" backfill \
    --config "$PROJECT_DIR/test-configs/base-test.yaml" \
    --from-block 10000000 \
    --to-block 10010000 \
    --verbose \
    > "$PROJECT_DIR/logs/base-test.log" 2>&1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Base test completed${NC}"
else
    echo -e "${RED}✗ Base test failed (check logs)${NC}"
fi
echo ""

echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}Multi-chain tests completed!${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo "Long-running tests still active:"
echo "  [1] Watch Mode (Ethereum)"
echo "  [2] Load Test (Ethereum)"
echo ""
echo "View results:"
echo "  ${YELLOW}$SCRIPT_DIR/monitor-tests.sh summary${NC}"
echo ""
