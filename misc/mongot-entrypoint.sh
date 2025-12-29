#!/bin/bash
set -e

# Get environment variables - use admin (root) user credentials
MONGO_ROOT_USERNAME="${MONGO_INITDB_ROOT_USERNAME:-}"
MONGO_ROOT_PASSWORD="${MONGO_INITDB_ROOT_PASSWORD:-}"

if [ -z "$MONGO_ROOT_USERNAME" ] || [ -z "$MONGO_ROOT_PASSWORD" ]; then
  echo "Error: MONGO_INITDB_ROOT_USERNAME and MONGO_INITDB_ROOT_PASSWORD environment variables are required"
  exit 1
fi

# Create password file from root user password
echo -n "$MONGO_ROOT_PASSWORD" > /mongot-community/pwfile
chmod 400 /mongot-community/pwfile
echo "Password file created from admin user password"

# Wait for MongoDB to be reachable
echo "Waiting for MongoDB to be reachable..."
for i in {1..120}; do
  # Simple TCP connection check using bash built-in /dev/tcp
  if bash -c "echo > /dev/tcp/mongo/27017" 2>/dev/null; then
    echo "MongoDB is reachable on mongo:27017"
    # Give MongoDB a bit more time to fully initialize and replica set to be ready
    sleep 5
    break
  fi
  
  if [ $i -eq 120 ]; then
    echo "ERROR: MongoDB failed to become reachable within 120 seconds"
    exit 1
  fi
  sleep 1
done

# Copy and update mongot.conf with admin (root) user credentials
# The mounted config is read-only, so we copy it to a writable location
if [ -f /mongot-community/config.default.yml ]; then
  # Copy to a writable location and update username to admin user
  cp /mongot-community/config.default.yml /tmp/config.default.yml
  # Replace any username with admin username
  sed -i "s/username:.*/username: $MONGO_ROOT_USERNAME/g" /tmp/config.default.yml
  
  # Ensure authSource is set to admin
  if ! grep -q "authSource:" /tmp/config.default.yml; then
    # Add authSource after username line
    sed -i "/username: $MONGO_ROOT_USERNAME/a\    authSource: admin" /tmp/config.default.yml
  else
    # Update existing authSource
    sed -i "s/authSource:.*/authSource: admin/g" /tmp/config.default.yml
  fi
  
  echo "Updated mongot.conf with admin username: $MONGO_ROOT_USERNAME and authSource: admin"
fi

# Verify configuration has authentication settings
echo "Verifying mongot configuration..."
if grep -q "username:" /tmp/config.default.yml && grep -q "passwordFile:" /tmp/config.default.yml && grep -q "authSource:" /tmp/config.default.yml; then
  echo "Mongot configuration verified: authentication is enabled"
  echo "  Username: $MONGO_ROOT_USERNAME (admin user)"
  echo "  Password file: /mongot-community/pwfile"
  echo "  Auth source: admin"
else
  echo "WARNING: Authentication settings may be missing in config"
fi

# Execute mongot with the updated config file
# The mongot binary is located at /mongot-community/mongot
echo "Starting mongot with authentication..."
exec /mongot-community/mongot --config /tmp/config.default.yml

