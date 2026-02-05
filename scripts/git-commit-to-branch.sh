#!/bin/bash

# Commit changes to another branch and optionally merge back to current branch
# Usage: ./git-commit-to-branch.sh [OPTIONS]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
TARGET_BRANCH=""
COMMIT_MSG=""
DO_PUSH=false
NO_MERGE=false
CREATE_BRANCH=false
SKIP_CONFIRM=false
STAGED_ONLY=false
STASH_CREATED=false
UNSTAGED_STASH_CREATED=false
ORIGINAL_BRANCH=""

# Show help message
show_help() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Commit changes to another branch and optionally merge back to current branch.

Options:
  -b, --branch <name>    Target branch to commit to
  -m, --message <msg>    Commit message
  -s, --staged-only      Only commit staged changes (keep unstaged changes)
  -p, --push             Push changes after commit
  -n, --no-merge         Skip merging back to current branch
  -c, --create           Create target branch if it doesn't exist
  -y, --yes              Skip confirmation prompt
  -h, --help             Show this help message

Examples:
  $(basename "$0")                              # Interactive mode (all changes)
  $(basename "$0") -s                           # Only commit staged changes
  $(basename "$0") -b feature -m "Add feature"  # Non-interactive
  $(basename "$0") -b feature -m "Fix" -s       # Staged only, non-interactive
  $(basename "$0") -b feature -m "Fix" -p       # Commit and push
  $(basename "$0") -b feature -m "Fix" -n       # Commit without merge
  $(basename "$0") -b new-feature -m "Init" -c  # Create branch if needed
EOF
}

# Cleanup function for error recovery
cleanup() {
    local exit_code=$?
    if [ $exit_code -ne 0 ]; then
        echo -e "\n${RED}Error occurred. Attempting to recover...${NC}"

        # Try to get back to original branch
        if [ -n "$ORIGINAL_BRANCH" ]; then
            current=$(git branch --show-current 2>/dev/null || echo "")
            if [ "$current" != "$ORIGINAL_BRANCH" ]; then
                echo -e "${YELLOW}Switching back to $ORIGINAL_BRANCH...${NC}"
                git checkout "$ORIGINAL_BRANCH" 2>/dev/null || true
            fi
        fi

        # Restore stashed changes
        if [ "$STASH_CREATED" = true ]; then
            echo -e "${YELLOW}Attempting to restore stashed changes...${NC}"
            if ! git stash pop 2>/dev/null; then
                echo -e "${RED}Could not auto-restore changes. Your changes are in 'git stash list'.${NC}"
                echo -e "${YELLOW}Run 'git stash pop' manually to restore them.${NC}"
            fi
        fi

        # Restore unstaged stash if it exists (for staged-only mode)
        if [ "$UNSTAGED_STASH_CREATED" = true ]; then
            echo -e "${YELLOW}Attempting to restore unstaged changes...${NC}"
            if ! git stash pop 2>/dev/null; then
                echo -e "${RED}Could not auto-restore unstaged changes. Check 'git stash list'.${NC}"
            fi
        fi
    fi
    exit $exit_code
}

trap cleanup EXIT

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -b|--branch)
            TARGET_BRANCH="$2"
            shift 2
            ;;
        -m|--message)
            COMMIT_MSG="$2"
            shift 2
            ;;
        -s|--staged-only)
            STAGED_ONLY=true
            shift
            ;;
        -p|--push)
            DO_PUSH=true
            shift
            ;;
        -n|--no-merge)
            NO_MERGE=true
            shift
            ;;
        -c|--create)
            CREATE_BRANCH=true
            shift
            ;;
        -y|--yes)
            SKIP_CONFIRM=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use -h or --help for usage information"
            exit 1
            ;;
    esac
done

# Get current branch
ORIGINAL_BRANCH=$(git branch --show-current)

if [ -z "$ORIGINAL_BRANCH" ]; then
    echo -e "${RED}Error: Not in a git repository or HEAD is detached${NC}"
    exit 1
fi

# Check for changes based on mode
if [ "$STAGED_ONLY" = true ]; then
    # Check for staged changes
    if [ -z "$(git diff --cached --name-only)" ]; then
        echo -e "${RED}Error: No staged changes to commit${NC}"
        echo -e "${YELLOW}Tip: Stage files with 'git add <file>' first, or remove -s flag${NC}"
        exit 1
    fi
else
    # Check for any uncommitted changes
    if [ -z "$(git status --porcelain)" ]; then
        echo -e "${RED}Error: No changes to commit${NC}"
        exit 1
    fi
fi

echo -e "${YELLOW}Current branch: ${GREEN}$ORIGINAL_BRANCH${NC}"
echo ""

# Show files to be committed
if [ "$STAGED_ONLY" = true ]; then
    echo -e "${YELLOW}Staged files to be committed:${NC}"
    git --no-pager diff --cached --name-status

    # Show unstaged changes that will be preserved
    if [ -n "$(git diff --name-only)" ] || [ -n "$(git ls-files --others --exclude-standard)" ]; then
        echo ""
        echo -e "${YELLOW}Unstaged changes (will be preserved):${NC}"
        git --no-pager status --short | grep -v "^[MARCD] " || true
    fi
else
    echo -e "${YELLOW}Files to be committed:${NC}"
    git --no-pager status --short
fi
echo ""

# Get target branch (interactive if not provided)
if [ -z "$TARGET_BRANCH" ]; then
    read -p "Target branch to commit to: " TARGET_BRANCH
fi

if [ -z "$TARGET_BRANCH" ]; then
    echo -e "${RED}Error: Target branch is required${NC}"
    exit 1
fi

# Check if target branch exists
if ! git show-ref --verify --quiet "refs/heads/$TARGET_BRANCH"; then
    if [ "$CREATE_BRANCH" = true ]; then
        echo -e "${YELLOW}Branch '$TARGET_BRANCH' does not exist. Will create it.${NC}"
    else
        echo -e "${RED}Error: Branch '$TARGET_BRANCH' does not exist${NC}"
        echo -e "${YELLOW}Tip: Use -c or --create to create the branch${NC}"
        exit 1
    fi
fi

# Get commit message (interactive if not provided)
if [ -z "$COMMIT_MSG" ]; then
    read -p "Commit message: " COMMIT_MSG
fi

if [ -z "$COMMIT_MSG" ]; then
    echo -e "${RED}Error: Commit message is required${NC}"
    exit 1
fi

# Ask for confirmation (unless skipped)
if [ "$SKIP_CONFIRM" != true ]; then
    echo ""
    echo -e "${YELLOW}Summary:${NC}"
    echo -e "  From: ${GREEN}$ORIGINAL_BRANCH${NC}"
    echo -e "  Commit to: ${GREEN}$TARGET_BRANCH${NC}"
    echo -e "  Message: ${GREEN}$COMMIT_MSG${NC}"
    if [ "$STAGED_ONLY" = true ]; then
        echo -e "  Mode: ${GREEN}Staged only${NC}"
    else
        echo -e "  Mode: ${GREEN}All changes${NC}"
    fi
    if [ "$NO_MERGE" = true ]; then
        echo -e "  Merge back: ${YELLOW}No${NC}"
    else
        echo -e "  Merge back: ${GREEN}Yes${NC}"
    fi
    if [ "$DO_PUSH" = true ]; then
        echo -e "  Push: ${GREEN}Yes${NC}"
    fi
    echo ""
    read -p "Proceed? (y/n): " CONFIRM

    if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
        echo "Aborted."
        exit 0
    fi
fi

echo ""

if [ "$STAGED_ONLY" = true ]; then
    # Staged-only mode: stash unstaged changes first, then staged changes

    # Check if there are unstaged changes to preserve
    HAS_UNSTAGED=false
    if [ -n "$(git diff --name-only)" ] || [ -n "$(git ls-files --others --exclude-standard)" ]; then
        HAS_UNSTAGED=true
        echo -e "${YELLOW}Stashing unstaged changes...${NC}"
        # Use || true to ignore permission warnings (e.g., Docker volumes)
        git stash --keep-index --include-untracked || true
        # Verify stash was created
        if git stash list | head -1 | grep -q "WIP on"; then
            UNSTAGED_STASH_CREATED=true
        else
            echo -e "${RED}Error: Failed to stash unstaged changes${NC}"
            exit 1
        fi
    fi

    echo -e "${YELLOW}Stashing staged changes...${NC}"
    git stash || true
    if git stash list | head -1 | grep -q "WIP on"; then
        STASH_CREATED=true
    else
        echo -e "${RED}Error: Failed to stash staged changes${NC}"
        exit 1
    fi
else
    # All changes mode: stash everything
    echo -e "${YELLOW}Stashing changes...${NC}"
    git stash || true
    if git stash list | head -1 | grep -q "WIP on"; then
        STASH_CREATED=true
    else
        echo -e "${RED}Error: Failed to stash changes${NC}"
        exit 1
    fi
fi

# Create branch if needed
if ! git show-ref --verify --quiet "refs/heads/$TARGET_BRANCH"; then
    echo -e "${YELLOW}Creating branch $TARGET_BRANCH...${NC}"
    git branch "$TARGET_BRANCH"
fi

echo -e "${YELLOW}Switching to $TARGET_BRANCH...${NC}"
git checkout "$TARGET_BRANCH"

echo -e "${YELLOW}Applying stashed changes...${NC}"
if ! git stash pop; then
    echo -e "${RED}Error: Conflict while applying stashed changes${NC}"
    echo -e "${YELLOW}Please resolve conflicts manually, then commit.${NC}"
    echo -e "${YELLOW}Your changes are still available in 'git stash list' if needed.${NC}"
    STASH_CREATED=false  # Don't try to pop again in cleanup
    exit 1
fi
STASH_CREATED=false  # Successfully popped

echo -e "${YELLOW}Committing...${NC}"
if [ "$STAGED_ONLY" = true ]; then
    # Changes are already staged from the stash
    git commit -m "$COMMIT_MSG"
else
    git add -A
    git commit -m "$COMMIT_MSG"
fi

# Push target branch if requested
if [ "$DO_PUSH" = true ]; then
    echo -e "${YELLOW}Pushing $TARGET_BRANCH...${NC}"
    git push -u origin "$TARGET_BRANCH"
fi

# Merge back unless --no-merge
if [ "$NO_MERGE" != true ]; then
    echo -e "${YELLOW}Switching back to $ORIGINAL_BRANCH...${NC}"
    git checkout "$ORIGINAL_BRANCH"

    echo -e "${YELLOW}Merging $TARGET_BRANCH into $ORIGINAL_BRANCH...${NC}"
    git merge "$TARGET_BRANCH"

    # Restore unstaged changes if in staged-only mode
    if [ "$STAGED_ONLY" = true ] && [ "$UNSTAGED_STASH_CREATED" = true ]; then
        echo -e "${YELLOW}Restoring unstaged changes...${NC}"
        if ! git stash pop; then
            echo -e "${RED}Warning: Conflict restoring unstaged changes${NC}"
            echo -e "${YELLOW}Your unstaged changes are in 'git stash list'.${NC}"
            UNSTAGED_STASH_CREATED=false
        else
            UNSTAGED_STASH_CREATED=false
        fi
    fi

    # Push current branch if requested
    if [ "$DO_PUSH" = true ]; then
        echo -e "${YELLOW}Pushing $ORIGINAL_BRANCH...${NC}"
        git push
    fi

    echo ""
    if [ "$STAGED_ONLY" = true ]; then
        echo -e "${GREEN}Done! Staged changes committed to $TARGET_BRANCH and merged into $ORIGINAL_BRANCH${NC}"
    else
        echo -e "${GREEN}Done! Changes committed to $TARGET_BRANCH and merged into $ORIGINAL_BRANCH${NC}"
    fi
else
    echo -e "${YELLOW}Switching back to $ORIGINAL_BRANCH...${NC}"
    git checkout "$ORIGINAL_BRANCH"

    # Restore unstaged changes if in staged-only mode
    if [ "$STAGED_ONLY" = true ] && [ "$UNSTAGED_STASH_CREATED" = true ]; then
        echo -e "${YELLOW}Restoring unstaged changes...${NC}"
        if ! git stash pop; then
            echo -e "${RED}Warning: Conflict restoring unstaged changes${NC}"
            echo -e "${YELLOW}Your unstaged changes are in 'git stash list'.${NC}"
            UNSTAGED_STASH_CREATED=false
        else
            UNSTAGED_STASH_CREATED=false
        fi
    fi

    echo ""
    if [ "$STAGED_ONLY" = true ]; then
        echo -e "${GREEN}Done! Staged changes committed to $TARGET_BRANCH (no merge)${NC}"
    else
        echo -e "${GREEN}Done! Changes committed to $TARGET_BRANCH (no merge)${NC}"
    fi
fi
