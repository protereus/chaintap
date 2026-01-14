#!/bin/bash

# Quick validation test before starting extended tests
# Uses public RPCs to verify everything works

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "======================================"
echo "ChainTap Quick Validation Test"
echo "======================================"
echo ""

# Check build
echo -n "Checking build... "
if [ -f "$PROJECT_DIR/dist/cli/index.js" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "Run 'npm run build' first"
    exit 1
fi

# Check Node version
echo -n "Checking Node.js version... "
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -ge 18 ]; then
    echo -e "${GREEN}✓ ($(node --version))${NC}"
else
    echo -e "${RED}✗ ($(node --version))${NC}"
    echo "Node.js 18+ required"
    exit 1
fi

# Check tests pass
echo -n "Running unit tests... "
cd "$PROJECT_DIR"
npm test > /tmp/chaintap-test.log 2>&1
if [ $? -eq 0 ]; then
    TEST_COUNT=$(grep "Tests.*passed" /tmp/chaintap-test.log | grep -o "[0-9]\+ passed" | head -1 | cut -d' ' -f1)
    echo -e "${GREEN}✓ ($TEST_COUNT tests passed)${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "Tests failed. Check /tmp/chaintap-test.log"
    exit 1
fi

# Quick smoke test with public RPC
echo ""
echo "Running quick smoke test (Ethereum public RPC)..."

# Create temp config
cat > /tmp/chaintap-validation.yaml <<EOF
chain: ethereum
database:
  type: sqlite
  path: /tmp/chaintap-validation.db

contracts:
  - address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
    name: "UNI Token"
    events:
      - Transfer
    from_block: 19000000

providers:
  - url: "https://eth.llamarpc.com"
    priority: 1
  - url: "https://ethereum.publicnode.com"
    priority: 2
  - url: "https://eth.drpc.org"
    priority: 3

options:
  batch_size: 10
  confirmations: 0
  max_retries: 3
EOF

# Clean previous test
rm -f /tmp/chaintap-validation.db*

# Run backfill for small range
echo -n "Indexing blocks 19,000,000 - 19,000,010... "
timeout 120 node "$PROJECT_DIR/dist/cli/index.js" backfill \
    --config /tmp/chaintap-validation.yaml \
    --from-block 19000000 \
    --to-block 19000010 \
    > /tmp/chaintap-validation.log 2>&1

if [ $? -eq 0 ]; then
    EVENT_COUNT=$(sqlite3 /tmp/chaintap-validation.db "SELECT COUNT(*) FROM events;" 2>/dev/null || echo "0")
    echo -e "${GREEN}✓ ($EVENT_COUNT events)${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "Smoke test failed. Check /tmp/chaintap-validation.log"
    tail -20 /tmp/chaintap-validation.log
    exit 1
fi

# Test status command
echo -n "Testing status command... "
node "$PROJECT_DIR/dist/cli/index.js" status \
    --config /tmp/chaintap-validation.yaml \
    > /tmp/chaintap-status.log 2>&1

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    exit 1
fi

# Cleanup
rm -f /tmp/chaintap-validation.yaml /tmp/chaintap-validation.db* /tmp/chaintap-validation.log /tmp/chaintap-status.log

echo ""
echo -e "${GREEN}======================================"
echo "All validation checks passed!"
echo "======================================${NC}"
echo ""
echo "Ready to start extended testing."
echo ""
echo "Before starting:"
echo "  1. Set ALCHEMY_URL environment variable:"
echo "     ${YELLOW}export ALCHEMY_URL='https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY'${NC}"
echo ""
echo "  2. Start extended tests:"
echo "     ${YELLOW}./test-scripts/run-extended-tests.sh${NC}"
echo ""
echo "  3. Monitor progress:"
echo "     ${YELLOW}./test-scripts/monitor-tests.sh${NC}"
echo ""
