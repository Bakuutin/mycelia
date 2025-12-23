#!/bin/bash
# Script to ensure replicaset is initialized
# This can be run manually or as part of container startup
# Usage: docker-compose exec mongo /path/to/ensure-replicaset.sh
# Or: docker exec <container-name> bash /path/to/ensure-replicaset.sh

set -e

echo "Checking replicaset status..."

# Wait for MongoDB to be ready
echo "Waiting for MongoDB to be ready..."
for i in {1..30}; do
  if mongosh --quiet --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
    echo "MongoDB is ready"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "MongoDB failed to become ready"
    exit 1
  fi
  sleep 1
done

# Check and initialize replicaset if needed
echo "Checking replicaset configuration..."
mongosh --quiet --eval "
try {
  const status = rs.status();
  print('Replicaset already initialized');
  print('Replicaset name: ' + status.set);
  const primary = status.members.find(m => m.stateStr === 'PRIMARY');
  if (primary) {
    print('PRIMARY: ' + primary.name);
  } else {
    print('WARNING: No PRIMARY found in replicaset');
  }
} catch (error) {
  if (error.message.includes('no replset config has been received') || 
      error.message.includes('not yet initialized')) {
    print('Initializing replicaset...');
    const result =     rs.initiate({
      _id: 'rs0',
      members: [
        { _id: 0, host: 'mongo:27017' }
      ]
    });
    print('Replicaset initialization command sent');
    print('Waiting for PRIMARY to be elected...');
  } else {
    print('Error checking replicaset status: ' + error);
    throw error;
  }
}
"

# Wait for PRIMARY to be elected
echo "Waiting for PRIMARY to be elected..."
for i in {1..60}; do
  if mongosh --quiet --eval "
    try {
      const status = rs.status();
      if (status.members && status.members.length > 0) {
        const primary = status.members.find(m => m.stateStr === 'PRIMARY');
        if (primary) {
          print('SUCCESS: PRIMARY elected at ' + primary.name);
          quit(0);
        }
      }
      quit(1);
    } catch (e) {
      quit(1);
    }
  " > /dev/null 2>&1; then
    echo "Replicaset is ready with PRIMARY"
    break
  fi
  if [ $i -eq 60 ]; then
    echo "ERROR: PRIMARY was not elected within 60 seconds"
    echo "Current replicaset status:"
    mongosh --eval "rs.status()"
    exit 1
  fi
  sleep 1
done

echo "Replicaset check completed successfully."

