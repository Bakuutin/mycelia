#!/bin/bash
set -e
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

sleep 2

# Initialize replicaset if not already initialized
echo "Initializing replicaset..."
mongosh --quiet --eval "
try {
  const status = rs.status();
  print('Replicaset already initialized');
  print('Replicaset status: ' + JSON.stringify(status.set));
} catch (error) {
  if (error.message.includes('no replset config has been received') || 
      error.message.includes('not yet initialized')) {
    print('Initializing new replicaset...');
    const result =     rs.initiate({
      _id: 'rs0',
      members: [
        { _id: 0, host: 'mongo:27017' }
      ]
    });
    print('Replicaset initialization initiated');
  } else {
    print('Error checking replicaset status: ' + error);
    throw error;
  }
}
"

# Wait for replicaset to be ready after initialization
echo "Waiting for replicaset to be ready..."
for i in {1..60}; do
  if mongosh --quiet --eval "
    try {
      const status = rs.status();
      if (status.members && status.members.length > 0) {
        const primary = status.members.find(m => m.stateStr === 'PRIMARY');
        if (primary) {
          print('PRIMARY found');
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
    echo "Warning: Replicaset may not be fully ready, but continuing..."
  fi
  sleep 1
done

echo "MongoDB initialization completed."

