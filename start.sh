#!/bin/bash

echo ""
echo "========================================"
echo "  LOGAT - Mukunth's AI Assistant"
echo "========================================"
echo ""

if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js not found. Install from https://nodejs.org"
  exit 1
fi
echo "Node.js: $(node --version)"

# Add Python 3.9 bin to PATH so whisper is found
export PATH="$HOME/Library/Python/3.9/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

echo ""
echo "Checking Whisper..."
if command -v whisper &> /dev/null; then
  echo "Whisper: OK at $(which whisper)"
else
  echo "Installing Whisper..."
  pip3 install openai-whisper 2>&1 | tail -1
fi

echo ""
echo "Checking ffmpeg..."
if command -v ffmpeg &> /dev/null; then
  echo "ffmpeg: OK"
else
  echo "Installing ffmpeg..."
  /opt/homebrew/bin/brew install ffmpeg --quiet 2>/dev/null || brew install ffmpeg --quiet
fi

echo ""
echo "Installing dependencies..."
rm -rf node_modules package-lock.json
npm install --prefer-online --silent

echo ""

# Check if user wants to build a real .app
if [ "$1" == "--build" ]; then
  echo "Building LOGAT.app..."
  ./node_modules/.bin/electron-builder --mac dmg
  echo ""
  echo "Done! Find LOGAT.dmg in the dist/ folder."
  echo "Open it, drag LOGAT to Applications, done."
else
  echo "Launching LOGAT..."
  xattr -cr ./node_modules/electron/dist/Electron.app 2>/dev/null
  ./node_modules/.bin/electron .
fi
