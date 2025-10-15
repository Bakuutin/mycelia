#!/bin/bash
# Kill process using a specific port

PORT=${1:-5173}

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 Checking port $PORT...${NC}"
echo ""

# Check what's using the port
PIDS=$(lsof -ti :$PORT)

if [ -z "$PIDS" ]; then
    echo -e "${GREEN}✓${NC} Port $PORT is free"
    exit 0
fi

echo -e "${YELLOW}Processes using port $PORT:${NC}"
echo ""
lsof -i :$PORT
echo ""

# Show process details
for PID in $PIDS; do
    echo -e "${BLUE}Process $PID:${NC}"
    ps -p $PID -o pid,ppid,user,command | tail -n +2
    echo ""
done

# Ask for confirmation
echo -e "${YELLOW}Kill these processes? (y/N)${NC}"
read -r response

if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    for PID in $PIDS; do
        echo -e "Killing process $PID..."
        kill $PID
    done
    sleep 1

    # Check if killed successfully
    REMAINING=$(lsof -ti :$PORT)
    if [ -z "$REMAINING" ]; then
        echo -e "${GREEN}✅ Port $PORT is now free${NC}"
    else
        echo -e "${YELLOW}⚠️  Some processes still running, force killing...${NC}"
        lsof -ti :$PORT | xargs kill -9
        echo -e "${GREEN}✅ Port $PORT forcefully freed${NC}"
    fi
else
    echo -e "${YELLOW}Cancelled${NC}"
fi
