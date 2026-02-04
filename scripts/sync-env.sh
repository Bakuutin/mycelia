#!/bin/bash
# Sync .env with .env.example - adds missing variables with their default values
# Usage: ./scripts/sync-env.sh [--dry-run] [--all]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

ENV_FILE="$PROJECT_ROOT/.env"
ENV_EXAMPLE="$PROJECT_ROOT/.env.example"

DRY_RUN=false
INCLUDE_ALL=false

for arg in "$@"; do
    case $arg in
        --dry-run) DRY_RUN=true ;;
        --all) INCLUDE_ALL=true ;;
    esac
done

# Variables that have good defaults in docker-compose.yml (skip unless --all)
# FRONTEND_MODE defaults to 'prod', BACKEND_TASK defaults to 'start'
OPTIONAL_VARS="FRONTEND_MODE BACKEND_TASK"

# Variables that need generated values instead of example defaults
generate_value() {
    local var_name="$1"
    case "$var_name" in
        SECRET_KEY)
            openssl rand -hex 32
            ;;
        *)
            return 1
            ;;
    esac
}

is_optional() {
    local var_name="$1"
    [[ " $OPTIONAL_VARS " == *" $var_name "* ]]
}

if [[ ! -f "$ENV_EXAMPLE" ]]; then
    echo "Error: .env.example not found at $ENV_EXAMPLE"
    exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
    echo "Error: .env not found at $ENV_FILE"
    echo "Hint: Copy .env.example to .env first: cp .env.example .env"
    exit 1
fi

# Extract active variable names (uncommented)
get_var_names() {
    grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$1" | cut -d= -f1 | sort -u
}

# Extract commented variable names from .env.example (format: # VAR=value)
get_commented_var_names() {
    grep -E '^# [A-Za-z_][A-Za-z0-9_]*=' "$1" | sed 's/^# //' | cut -d= -f1 | sort -u
}

# Get all known variable names (active + commented) from .env.example
get_all_known_vars() {
    {
        get_var_names "$1"
        get_commented_var_names "$1"
    } | sort -u
}

# Get variable with its value from .env.example (active line)
get_var_line() {
    local var_name="$1"
    grep -E "^${var_name}=" "$ENV_EXAMPLE" | head -1
}

# Check if variable is commented (optional) in .env.example
is_commented_in_example() {
    local var_name="$1"
    grep -qE "^# ${var_name}=" "$ENV_EXAMPLE"
}

echo "Comparing .env with .env.example..."
echo ""

# Find variables in .env.example that are not in .env
EXAMPLE_VARS=$(get_var_names "$ENV_EXAMPLE")
ENV_VARS=$(get_var_names "$ENV_FILE")

MISSING_VARS=()
SKIPPED_VARS=()
for var in $EXAMPLE_VARS; do
    if ! echo "$ENV_VARS" | grep -q "^${var}$"; then
        if is_optional "$var" && [[ "$INCLUDE_ALL" == false ]]; then
            SKIPPED_VARS+=("$var")
        else
            MISSING_VARS+=("$var")
        fi
    fi
done

# Get all known variables (active + commented) from .env.example
ALL_KNOWN_VARS=$(get_all_known_vars "$ENV_EXAMPLE")

# Find variables in .env that are optional (commented in example) or legacy (not in example at all)
OPTIONAL_ENABLED=()
LEGACY_VARS=()
for var in $ENV_VARS; do
    if ! echo "$EXAMPLE_VARS" | grep -q "^${var}$"; then
        # Not an active var in example - check if it's commented (optional) or truly unknown (legacy)
        if echo "$ALL_KNOWN_VARS" | grep -q "^${var}$"; then
            OPTIONAL_ENABLED+=("$var")
        else
            LEGACY_VARS+=("$var")
        fi
    fi
done

# Show optional variables that user has enabled
if [[ ${#OPTIONAL_ENABLED[@]} -gt 0 ]]; then
    echo "Optional variables enabled in .env (${#OPTIONAL_ENABLED[@]} found):"
    echo "(These are commented in .env.example but you've enabled them)"
    echo ""
    for var in "${OPTIONAL_ENABLED[@]}"; do
        value=$(grep -E "^${var}=" "$ENV_FILE" | head -1 | cut -d= -f2-)
        echo "  ${var}=${value}"
    done
    echo ""
fi

# Show legacy/unknown variables
if [[ ${#LEGACY_VARS[@]} -gt 0 ]]; then
    echo "Legacy variables in .env (${#LEGACY_VARS[@]} found):"
    echo "(Not in .env.example - consider removing)"
    echo ""
    for var in "${LEGACY_VARS[@]}"; do
        value=$(grep -E "^${var}=" "$ENV_FILE" | head -1 | cut -d= -f2-)
        echo "  ${var}=${value}"
    done
    echo ""
fi

if [[ ${#MISSING_VARS[@]} -eq 0 ]]; then
    echo "✓ Your .env has all required variables from .env.example"
    if [[ ${#SKIPPED_VARS[@]} -gt 0 ]]; then
        echo ""
        echo "Skipped optional variables (use --all to include):"
        for var in "${SKIPPED_VARS[@]}"; do
            echo "  $var (has default in docker-compose.yml)"
        done
    fi
    exit 0
fi

echo "Missing variables in .env (${#MISSING_VARS[@]} found):"
echo ""

LINES_TO_ADD=""
for var in "${MISSING_VARS[@]}"; do
    # Check if this var needs a generated value
    if generated=$(generate_value "$var" 2>/dev/null); then
        line="${var}=${generated}"
        echo "  $line  (generated)"
    else
        line=$(get_var_line "$var")
        echo "  $line"
    fi
    LINES_TO_ADD+="$line"$'\n'
done

if [[ ${#SKIPPED_VARS[@]} -gt 0 ]]; then
    echo ""
    echo "Skipped optional variables (use --all to include):"
    for var in "${SKIPPED_VARS[@]}"; do
        echo "  $var"
    done
fi

echo ""

if [[ "$DRY_RUN" == true ]]; then
    echo "[Dry run] Would add the above variables to .env"
    exit 0
fi

read -p "Add these variables to .env? [y/N] " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "" >> "$ENV_FILE"
    echo "# --- Added from .env.example ($(date +%Y-%m-%d)) ---" >> "$ENV_FILE"
    echo -n "$LINES_TO_ADD" >> "$ENV_FILE"
    echo "✓ Added ${#MISSING_VARS[@]} variable(s) to .env"
else
    echo "Skipped. No changes made."
fi
