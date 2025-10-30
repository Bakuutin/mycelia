#!/bin/bash
# Start Mycelia server with logging enabled

set -e

# Configuration
LOG_DIR="${HOME}/mycelia-logs"
LOG_FILE="${LOG_DIR}/server.log"
PID_FILE="${LOG_DIR}/server.pid"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Mycelia Server with Logging${NC}"
echo ""

# Create logs directory
mkdir -p "$LOG_DIR"
echo -e "${GREEN}✓${NC} Created log directory: $LOG_DIR"

# Check if server is already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Server already running with PID $OLD_PID${NC}"
        echo ""
        echo "Options:"
        echo "  1. Stop it first: kill $OLD_PID"
        echo "  2. View logs: tail -f $LOG_FILE"
        exit 1
    else
        echo -e "${YELLOW}⚠️  Removing stale PID file${NC}"
        rm "$PID_FILE"
    fi
fi

# Change to repo directory
cd "$(dirname "$0")/.."

# Start server in background
echo -e "${GREEN}✓${NC} Starting server in background..."
nohup deno task dev > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

# Save PID
echo "$SERVER_PID" > "$PID_FILE"
echo -e "${GREEN}✓${NC} Server started with PID: $SERVER_PID"
echo -e "${GREEN}✓${NC} Logs: $LOG_FILE"
echo ""

# Wait a moment for server to start
sleep 2

# Check if still running
if ps -p "$SERVER_PID" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Server is running!${NC}"
    echo ""
    echo "Useful commands:"
    echo -e "  ${BLUE}# View logs in real-time${NC}"
    echo "  tail -f $LOG_FILE"
    echo ""
    echo -e "  ${BLUE}# View logs with Timeline filtering${NC}"
    echo "  tail -f $LOG_FILE | grep --color=always Timeline"
    echo ""
    echo -e "  ${BLUE}# Stop the server${NC}"
    echo "  kill $SERVER_PID"
    echo "  # or: pkill -f 'deno task dev'"
    echo ""
    echo -e "${YELLOW}Starting live log view...${NC} (Press Ctrl+C to stop viewing logs, server will keep running)"
    echo ""
    sleep 1
    tail -f "$LOG_FILE"
else
    echo -e "${RED}❌ Server failed to start${NC}"
    echo "Check logs at: $LOG_FILE"
    rm "$PID_FILE"
    exit 1
fi
