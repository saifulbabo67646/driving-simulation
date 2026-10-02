@echo off
REM Starts a local web server and opens the simulator (needs Python 3 installed).
cd /d "%~dp0"
start "" http://localhost:8080/
python -m http.server 8080
