#!/usr/bin/env bash
# Build the React client and stage everything the hosted demo needs.
#
#   ./deploy/stage.sh /path/to/staging-dir
#
# The staging directory then holds:
#   worker/index.js   the API + static asset handler
#   public/           the compiled React app
#   deploy.json       entrypoint + assets for the deployer
#
# Nothing else is copied: no node_modules, no .env, no server credentials.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-}"

if [ -z "$TARGET" ]; then
  echo "usage: $0 <staging-dir>" >&2
  exit 1
fi

echo "Building the client..."
(cd "$ROOT/client" && NODE_OPTIONS=--openssl-legacy-provider npm run build)

echo "Staging into $TARGET"
rm -rf "$TARGET/worker" "$TARGET/public"
mkdir -p "$TARGET/worker" "$TARGET/public"
cp "$ROOT/worker/index.js" "$TARGET/worker/index.js"
cp "$ROOT/deploy/deploy.json" "$TARGET/deploy.json"
cp -R "$ROOT/client/build/." "$TARGET/public/"

# Source maps and dotfiles are not public build output, and the deployer rejects
# them: shipping maps would also publish the full readable source of the app.
find "$TARGET/public" -name '*.map' -delete
find "$TARGET/public" -name '.*' -type f -delete

echo "Staged $(find "$TARGET/public" -type f | wc -l | tr -d ' ') asset files."
