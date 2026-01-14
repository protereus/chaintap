#!/bin/bash

# Stop all running extended tests

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "Stopping extended tests..."
echo ""

# Stop watch mode
if [ -f "$PROJECT_DIR/pids/ethereum-watch.pid" ]; then
    PID=$(cat "$PROJECT_DIR/pids/ethereum-watch.pid")
    if ps -p "$PID" > /dev/null 2>&1; then
        kill "$PID"
        echo -e "${GREEN}✓ Stopped watch mode (PID: $PID)${NC}"
    fi
    rm -f "$PROJECT_DIR/pids/ethereum-watch.pid"
fi

# Stop load test
if [ -f "$PROJECT_DIR/pids/ethereum-load.pid" ]; then
    PID=$(cat "$PROJECT_DIR/pids/ethereum-load.pid")
    if ps -p "$PID" > /dev/null 2>&1; then
        kill "$PID"
        echo -e "${GREEN}✓ Stopped load test (PID: $PID)${NC}"
    fi
    rm -f "$PROJECT_DIR/pids/ethereum-load.pid"
fi

echo ""
echo "All tests stopped."
echo ""
echo "View final results:"
echo "  $SCRIPT_DIR/monitor-tests.sh summary"
