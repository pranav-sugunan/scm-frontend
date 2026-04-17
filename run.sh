#!/bin/bash

PORT=3000
DIR="$(cd "$(dirname "$0")/frontend" && pwd)"

echo "Starting SCM Frontend..."
echo "Serving from: $DIR"
echo "Open http://localhost:$PORT in your browser"
echo "Press Ctrl+C to stop"
echo ""

python3 -m http.server "$PORT" --directory "$DIR"
