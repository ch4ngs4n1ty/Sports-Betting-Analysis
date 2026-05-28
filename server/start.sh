#!/bin/bash
# PlayIQ Backend — start or restart
cd "$(dirname "$0")"

# Kill any existing instance
lsof -ti:3001 | xargs kill -9 2>/dev/null
sleep 0.3

# Start server, log to file
nohup node index.js >> server.log 2>&1 &
echo "PlayIQ server started (PID $!)"
