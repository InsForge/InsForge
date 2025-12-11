#!/bin/bash

# =============================================================================
# EC2 Real-time Memory Monitor
# =============================================================================
# Copy this script to your EC2 instance and run it while testing
# Usage: ./ec2-memory-monitor.sh
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  EC2 MEMORY MONITOR - Press Ctrl+C to stop${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Get initial state
TOTAL_MEM=$(free -m | awk 'NR==2{print $2}')
echo -e "Total RAM: ${YELLOW}${TOTAL_MEM}MB${NC}"
echo ""

# Warning threshold (when to show red)
WARN_THRESHOLD=$((TOTAL_MEM * 85 / 100))  # 85% usage

echo "Timestamp          | Total | Used  | Free  | Avail | Node.js | PostgreSQL"
echo "-------------------|-------|-------|-------|-------|---------|----------"

while true; do
    # Get memory stats
    MEM_STATS=$(free -m | awk 'NR==2{print $2, $3, $4, $7}')
    TOTAL=$(echo $MEM_STATS | cut -d' ' -f1)
    USED=$(echo $MEM_STATS | cut -d' ' -f2)
    FREE=$(echo $MEM_STATS | cut -d' ' -f3)
    AVAIL=$(echo $MEM_STATS | cut -d' ' -f4)

    # Get Node.js memory (RSS in MB)
    NODE_PID=$(pgrep -f "node.*server" | head -1)
    if [ -n "$NODE_PID" ]; then
        NODE_MEM=$(ps -o rss= -p $NODE_PID 2>/dev/null | awk '{printf "%.0f", $1/1024}')
    else
        NODE_MEM="N/A"
    fi

    # Get PostgreSQL memory
    PG_PID=$(pgrep -x "postgres" | head -1)
    if [ -n "$PG_PID" ]; then
        # Sum all postgres processes
        PG_MEM=$(ps -o rss= -C postgres 2>/dev/null | awk '{sum+=$1} END {printf "%.0f", sum/1024}')
    else
        PG_MEM="N/A"
    fi

    # Color based on usage
    if [ "$USED" -gt "$WARN_THRESHOLD" ]; then
        COLOR=$RED
    elif [ "$USED" -gt $((TOTAL_MEM * 70 / 100)) ]; then
        COLOR=$YELLOW
    else
        COLOR=$GREEN
    fi

    TIMESTAMP=$(date '+%H:%M:%S.%3N')

    printf "${COLOR}%s | %5s | %5s | %5s | %5s | %7s | %7s${NC}\n" \
        "$TIMESTAMP" "${TOTAL}MB" "${USED}MB" "${FREE}MB" "${AVAIL}MB" "${NODE_MEM}MB" "${PG_MEM}MB"

    # Check for OOM risk
    if [ "$AVAIL" -lt 50 ]; then
        echo -e "${RED}⚠️  WARNING: Available memory below 50MB - OOM risk!${NC}"
    fi

    sleep 0.5
done
