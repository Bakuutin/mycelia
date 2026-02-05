#!/bin/bash

# Commit changes to another branch and merge back to current branch
# Usage: ./git-commit-to-branch.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)

if [ -z "$CURRENT_BRANCH" ]; then
    echo -e "${RED}Error: Not in a git repository or HEAD is detached${NC}"
    exit 1
fi

# Check for uncommitted changes
if [ -z "$(git status --porcelain)" ]; then
    echo -e "${RED}Error: No changes to commit${NC}"
    exit 1
fi

echo -e "${YELLOW}Current branch: ${GREEN}$CURRENT_BRANCH${NC}"
echo ""

# Get target branch
read -p "Target branch to commit to: " TARGET_BRANCH

if [ -z "$TARGET_BRANCH" ]; then
    echo -e "${RED}Error: Target branch is required${NC}"
    exit 1
fi

# Check if target branch exists
if ! git show-ref --verify --quiet "refs/heads/$TARGET_BRANCH"; then
    echo -e "${RED}Error: Branch '$TARGET_BRANCH' does not exist${NC}"
    exit 1
fi

# Get commit message
read -p "Commit message: " COMMIT_MSG

if [ -z "$COMMIT_MSG" ]; then
    echo -e "${RED}Error: Commit message is required${NC}"
    exit 1
fi

# Ask for confirmation
echo ""
echo -e "${YELLOW}Summary:${NC}"
echo -e "  From: ${GREEN}$CURRENT_BRANCH${NC}"
echo -e "  Commit to: ${GREEN}$TARGET_BRANCH${NC}"
echo -e "  Message: ${GREEN}$COMMIT_MSG${NC}"
echo ""
read -p "Proceed? (y/n): " CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo -e "${YELLOW}Stashing changes...${NC}"
git stash

echo -e "${YELLOW}Switching to $TARGET_BRANCH...${NC}"
git checkout "$TARGET_BRANCH"

echo -e "${YELLOW}Applying stashed changes...${NC}"
git stash pop

echo -e "${YELLOW}Committing...${NC}"
git add -A
git commit -m "$COMMIT_MSG"

echo -e "${YELLOW}Switching back to $CURRENT_BRANCH...${NC}"
git checkout "$CURRENT_BRANCH"

echo -e "${YELLOW}Merging $TARGET_BRANCH into $CURRENT_BRANCH...${NC}"
git merge "$TARGET_BRANCH"

echo ""
echo -e "${GREEN}Done! Changes committed to $TARGET_BRANCH and merged into $CURRENT_BRANCH${NC}"
