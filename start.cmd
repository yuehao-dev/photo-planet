@echo off
cd /d "%~dp0"
echo Photo Planet demo: http://127.0.0.1:5180/
echo Press Ctrl+C to stop. This preview listens on this computer only.
python -m http.server 5180 --bind 127.0.0.1
