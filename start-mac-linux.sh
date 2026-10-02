#!/bin/sh
# Starts a local web server and opens the simulator (needs Python 3).
cd "$(dirname "$0")"
( sleep 1; (command -v open >/dev/null && open http://localhost:8080/) || (command -v xdg-open >/dev/null && xdg-open http://localhost:8080/) ) &
python3 -m http.server 8080
