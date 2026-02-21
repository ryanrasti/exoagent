#!/usr/bin/env bash
# Restart the dev server

cd "$(dirname "$0")/.."

pkill -f 'tsx.*server' 2>/dev/null
pkill -f 'concurrently.*vite' 2>/dev/null
pkill -f 'vite' 2>/dev/null

sleep 1

nohup npm run dev:web > /tmp/exoagent-server.log 2>&1 &
echo "Server started (logs at /tmp/exoagent-server.log)"
