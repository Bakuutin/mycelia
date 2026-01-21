#!/bin/sh
set -e

SSL_DIR="/etc/nginx/ssl"
CERT_FILE="$SSL_DIR/fullchain.pem"
KEY_FILE="$SSL_DIR/privkey.pem"

# Generate self-signed certificates if they don't exist
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
    echo "SSL certificates not found. Generating self-signed certificates for development..."

    # Install openssl if not available
    if ! command -v openssl >/dev/null 2>&1; then
        apk add --no-cache openssl >/dev/null 2>&1
    fi

    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$KEY_FILE" \
        -out "$CERT_FILE" \
        -subj "/CN=localhost"

    echo "Self-signed certificates generated successfully."
fi

# Execute the original nginx entrypoint
exec /docker-entrypoint.sh "$@"
