#!/bin/bash
# misc/nginx/generate-self-signed.sh

# Load .env if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

DOMAIN=${MYCELIA_DOMAIN:-example.com}
SSL_DIR="./misc/nginx/ssl"

mkdir -p "$SSL_DIR"

echo "Generating self-signed certificate for $DOMAIN..."

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$SSL_DIR/privkey.pem" \
  -out "$SSL_DIR/fullchain.pem" \
  -subj "/C=US/ST=State/L=City/O=Mycelia/OU=IT/CN=$DOMAIN" \
  -addext "subjectAltName=DNS:$DOMAIN,DNS:*.$DOMAIN"

echo "Done! Certificates generated in $SSL_DIR"
echo "Note: Your browser will show a security warning because this is self-signed."



