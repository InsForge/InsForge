#!/bin/bash

# =============================================================================
# Local Memory Watch - Monitor Node.js backend memory in real-time
# =============================================================================

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  LOCAL MEMORY WATCH - Monitoring Node.js backend${NC}"
echo -e "${CYAN}  Press Ctrl+C to stop${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Find the Node.js process
find_node_pid() {
    pgrep -f "tsx.*server|node.*server" | head -1
}

NODE_PID=$(find_node_pid)
if [ -z "$NODE_PID" ]; then
    echo -e "${RED}No Node.js backend process found!${NC}"
    echo "Start the backend first: npm run dev"
    exit 1
fi

echo -e "Found Node.js process: ${GREEN}PID $NODE_PID${NC}"
echo ""

# Track baseline and peak
BASELINE=0
PEAK=0

echo "Time       | RSS (MB) | Heap Used | Change    | Status"
echo "-----------|----------|-----------|-----------|--------"

while true; do
    # Re-find PID in case process restarted
    NODE_PID=$(find_node_pid)
    if [ -z "$NODE_PID" ]; then
        echo -e "${RED}Process died! Waiting for restart...${NC}"
        sleep 1
        continue
    fi

    # Get RSS memory in KB then convert to MB
    RSS_KB=$(ps -o rss= -p $NODE_PID 2>/dev/null | tr -d ' ')
    if [ -z "$RSS_KB" ]; then
        continue
    fi

    RSS_MB=$((RSS_KB / 1024))

    # Set baseline on first reading
    if [ "$BASELINE" -eq 0 ]; then
        BASELINE=$RSS_MB
        PEAK=$RSS_MB
    fi

    # Track peak
    if [ "$RSS_MB" -gt "$PEAK" ]; then
        PEAK=$RSS_MB
    fi

    # Calculate change from baseline
    CHANGE=$((RSS_MB - BASELINE))
    if [ "$CHANGE" -ge 0 ]; then
        CHANGE_STR="+${CHANGE}MB"
    else
        CHANGE_STR="${CHANGE}MB"
    fi

    # Status indicator
    if [ "$CHANGE" -gt 100 ]; then
        STATUS="${RED}▲▲ SPIKE${NC}"
    elif [ "$CHANGE" -gt 50 ]; then
        STATUS="${YELLOW}▲ HIGH${NC}"
    elif [ "$CHANGE" -gt 20 ]; then
        STATUS="${YELLOW}~ ELEVATED${NC}"
    else
        STATUS="${GREEN}● NORMAL${NC}"
    fi

    TIMESTAMP=$(date '+%H:%M:%S')

    # Try to get V8 heap info via /proc (Linux only)
    HEAP_INFO="-"

    printf "%s | %6sMB | %9s | %9s | %b\n" \
        "$TIMESTAMP" "$RSS_MB" "$HEAP_INFO" "$CHANGE_STR" "$STATUS"

    sleep 0.5
done
