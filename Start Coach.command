#!/bin/bash
# Double-click this file to start the coach (Mac).
# It checks for Node.js, starts the coach, and opens it in your browser.

cd "$(dirname "$0")" || exit 1

# A double-clicked script does not always see the places Node gets installed.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Rift Coach needs a free program called Node.js to run,"
  echo "  and it is not on this Mac yet."
  echo
  echo "  Opening the download page for you. Click the big green"
  echo "  download button, install it, then double-click Start Coach again."
  echo
  open "https://nodejs.org/"
  read -n 1 -s -r -p "  Press any key to close this window."
  exit 1
fi

echo
echo "  Starting Rift Coach. Your browser will open by itself."
echo
echo "  KEEP THIS WINDOW OPEN while you play."
echo "  Closing it turns the coach off."
echo
node server.mjs --open "$@"
