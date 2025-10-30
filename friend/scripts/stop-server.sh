#!/bin/bash
# Stop Mycelia server

set -e

# Configuration
LOG_DIR="${HOME}/mycelia-logs"
PID_FILE="${LOG_DIR}/server.pid"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🛑 Stopping Mycelia Server${NC}"
echo ""

# Check if PID file exists
if [ ! -f "$PID_FILE" ]; then
    echo -e "${YELLOW}⚠️  No PID file found at $PID_FILE${NC}"
    echo "Server may not be running, or was started manually."
    echo ""
    echo "Try: pkill -f 'deno task dev'"
    exit 1
fi

# Read PID
SERVER_PID=$(cat "$PID_FILE")

# Check if process is running
if ! ps -p "$SERVER_PID" > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Server with PID $SERVER_PID is not running${NC}"
    rm "$PID_FILE"
    echo -e "${GREEN}✓${NC} Cleaned up stale PID file"
    exit 0
fi

# Stop the server
echo "Stopping server with PID: $SERVER_PID"
kill "$SERVER_PID"

# Wait for process to stop
sleep 1

# Verify it stopped
if ps -p "$SERVER_PID" > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Server didn't stop gracefully, forcing...${NC}"
    kill -9 "$SERVER_PID"
    sleep 1
fi

# Check if really stopped
if ps -p "$SERVER_PID" > /dev/null 2>&1; then
    echo -e "${RED}❌ Failed to stop server${NC}"
    exit 1
else
    echo -e "${GREEN}✅ Server stopped successfully${NC}"
    rm "$PID_FILE"
    echo -e "${GREEN}✓${NC} Cleaned up PID file"
fi
