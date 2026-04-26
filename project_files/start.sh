#!/usr/bin/env bash
PORT=8080
URL="http://localhost:$PORT/index.html"

fuser -k "$PORT/tcp" &>/dev/null; sleep 0.5

if command -v npx &>/dev/null; then
    echo "Starting server at $URL"
    xdg-open "$URL" &
    npx serve . --listen "$PORT"
elif command -v python3 &>/dev/null; then
    echo "npx not found, using python3. Starting server at $URL"
    xdg-open "$URL" &
    python3 -m http.server "$PORT"
else
    echo "Neither npx nor python3 found. Install Node.js or Python 3 to run a local server."
    exit 1
fi
