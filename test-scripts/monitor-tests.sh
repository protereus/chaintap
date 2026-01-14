#!/bin/bash

# Extended Testing Monitor Script for ChainTap
# Tracks metrics for watch mode, load testing, and multi-chain tests

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Monitoring functions
check_process() {
    local name=$1
    local pid_file=$2

    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if ps -p "$pid" > /dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} $name (PID: $pid)"
            return 0
        else
            echo -e "${RED}✗${NC} $name (PID file exists but process dead)"
            return 1
        fi
    else
        echo -e "${YELLOW}○${NC} $name (not running)"
        return 2
    fi
}

get_db_stats() {
    local db_path=$1
    local db_name=$2

    if [ ! -f "$db_path" ]; then
        echo -e "${YELLOW}  Database not found${NC}"
        return
    fi

    local event_count=$(sqlite3 "$db_path" "SELECT COUNT(*) FROM events;" 2>/dev/null || echo "0")
    local contract_count=$(sqlite3 "$db_path" "SELECT COUNT(DISTINCT contract_address) FROM events;" 2>/dev/null || echo "0")
    local block_range=$(sqlite3 "$db_path" "SELECT MIN(block_number), MAX(block_number) FROM events;" 2>/dev/null || echo "0|0")
    local db_size=$(du -h "$db_path" | cut -f1)

    echo -e "  ${BLUE}Events:${NC} $event_count"
    echo -e "  ${BLUE}Contracts:${NC} $contract_count"
    echo -e "  ${BLUE}Block Range:${NC} $block_range"
    echo -e "  ${BLUE}DB Size:${NC} $db_size"
}

get_memory_usage() {
    local pid=$1

    if ps -p "$pid" > /dev/null 2>&1; then
        local mem_kb=$(ps -o rss= -p "$pid" 2>/dev/null || echo "0")
        local mem_mb=$((mem_kb / 1024))
        echo "${mem_mb}MB"
    else
        echo "N/A"
    fi
}

get_uptime() {
    local pid_file=$1

    if [ -f "$pid_file" ]; then
        local start_time=$(stat -c %Y "$pid_file" 2>/dev/null || stat -f %m "$pid_file" 2>/dev/null || echo "0")
        local current_time=$(date +%s)
        local uptime_seconds=$((current_time - start_time))

        local hours=$((uptime_seconds / 3600))
        local minutes=$(( (uptime_seconds % 3600) / 60 ))

        echo "${hours}h ${minutes}m"
    else
        echo "N/A"
    fi
}

# Main monitoring loop
monitor() {
    while true; do
        clear
        echo "============================================"
        echo "ChainTap Extended Testing Monitor"
        echo "$(date '+%Y-%m-%d %H:%M:%S')"
        echo "============================================"
        echo ""

        # Test 1: Extended Watch Mode (Ethereum)
        echo -e "${BLUE}[1] Extended Watch Mode - Ethereum${NC}"
        check_process "Watch Mode" "$PROJECT_DIR/pids/ethereum-watch.pid"
        local watch_status=$?
        if [ $watch_status -eq 0 ]; then
            local pid=$(cat "$PROJECT_DIR/pids/ethereum-watch.pid")
            echo -e "  ${BLUE}Uptime:${NC} $(get_uptime "$PROJECT_DIR/pids/ethereum-watch.pid")"
            echo -e "  ${BLUE}Memory:${NC} $(get_memory_usage "$pid")"
        fi
        get_db_stats "$PROJECT_DIR/extended-test-ethereum.db" "Ethereum Watch"
        echo ""

        # Test 2: Load Test (Ethereum)
        echo -e "${BLUE}[2] Load Test - Ethereum (1M+ blocks)${NC}"
        check_process "Load Test" "$PROJECT_DIR/pids/ethereum-load.pid"
        local load_status=$?
        if [ $load_status -eq 0 ]; then
            local pid=$(cat "$PROJECT_DIR/pids/ethereum-load.pid")
            echo -e "  ${BLUE}Uptime:${NC} $(get_uptime "$PROJECT_DIR/pids/ethereum-load.pid")"
            echo -e "  ${BLUE}Memory:${NC} $(get_memory_usage "$pid")"
        fi
        get_db_stats "$PROJECT_DIR/load-test-ethereum.db" "Ethereum Load"
        echo ""

        # Test 3: Multi-Chain Tests
        echo -e "${BLUE}[3] Multi-Chain Tests${NC}"

        echo -e "  ${YELLOW}Polygon:${NC}"
        get_db_stats "$PROJECT_DIR/test-polygon.db" "Polygon"
        echo ""

        echo -e "  ${YELLOW}Arbitrum:${NC}"
        get_db_stats "$PROJECT_DIR/test-arbitrum.db" "Arbitrum"
        echo ""

        echo -e "  ${YELLOW}Base:${NC}"
        get_db_stats "$PROJECT_DIR/test-base.db" "Base"
        echo ""

        # System Resources
        echo -e "${BLUE}[System Resources]${NC}"
        echo -e "  ${BLUE}Total Memory:${NC} $(free -h | awk '/^Mem:/ {print $3 " / " $2}')"
        echo -e "  ${BLUE}Disk Usage:${NC} $(df -h "$PROJECT_DIR" | awk 'NR==2 {print $3 " / " $2 " (" $5 ")"}')"
        echo ""

        echo "============================================"
        echo "Press Ctrl+C to exit monitor"
        echo "Refresh in 30 seconds..."

        sleep 30
    done
}

# Command handling
case "${1:-monitor}" in
    monitor)
        monitor
        ;;
    summary)
        # One-time summary
        echo "ChainTap Extended Testing Summary"
        echo "=================================="
        echo ""
        echo "[1] Extended Watch Mode - Ethereum"
        check_process "Watch Mode" "$PROJECT_DIR/pids/ethereum-watch.pid"
        get_db_stats "$PROJECT_DIR/extended-test-ethereum.db" "Ethereum Watch"
        echo ""
        echo "[2] Load Test - Ethereum"
        check_process "Load Test" "$PROJECT_DIR/pids/ethereum-load.pid"
        get_db_stats "$PROJECT_DIR/load-test-ethereum.db" "Ethereum Load"
        echo ""
        echo "[3] Multi-Chain Tests"
        echo "Polygon:"
        get_db_stats "$PROJECT_DIR/test-polygon.db" "Polygon"
        echo ""
        echo "Arbitrum:"
        get_db_stats "$PROJECT_DIR/test-arbitrum.db" "Arbitrum"
        echo ""
        echo "Base:"
        get_db_stats "$PROJECT_DIR/test-base.db" "Base"
        ;;
    *)
        echo "Usage: $0 {monitor|summary}"
        echo "  monitor - Live monitoring (refreshes every 30s)"
        echo "  summary - One-time summary"
        exit 1
        ;;
esac
