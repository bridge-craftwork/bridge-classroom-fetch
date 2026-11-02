#!/bin/bash
# Build store-ready archives for every target.
#
#   scripts/package-stores.sh           Bridge Classroom Fetch
#   EXT=dd scripts/package-stores.sh    Bridge Craftwork DD
#
# Produces dist/packages/<name>-<version>-<target>.zip for Chrome, Edge and
# Firefox, plus a source archive for Firefox review. Safari is not a zip — it
# ships as a Mac app built in Xcode; this script refreshes the resources that
# project copies from, and tells you what to do next.

set -euo pipefail
cd "$(dirname "$0")/.."

EXT="${EXT:-fetch}"
if [ "$EXT" = "dd" ]; then
  NAME="bridge-craftwork-dd"
  MANIFEST="manifest.dd.json"
  DIST_PREFIX="dd-"
  SAFARI_RES="safari-dd/Bridge Craftwork DD/Bridge Craftwork DD Extension/Resources"
  SAFARI_PROJECT="safari-dd"
else
  NAME=$(python3 -c "import json;print(json.load(open('package.json'))['name'])")
  MANIFEST="manifest.json"
  DIST_PREFIX=""
  SAFARI_RES="safari/Bridge Classroom Fetch/Shared (Extension)/Resources"
  SAFARI_PROJECT="safari"
fi
export EXT
VERSION=$(python3 -c "import json;print(json.load(open('$MANIFEST'))['version'])")
OUT="dist/packages"

echo "==> $NAME $VERSION"
mkdir -p "$OUT"
rm -f "$OUT/$NAME-"*

# Guard: the test build widens host permissions for end-to-end testing and must
# never reach a store.
guard_test_origins() {
  local manifest="$1"
  if grep -qE "localhost|127\.0\.0\.1|github\.io" "$manifest"; then
    echo "REFUSING: $manifest contains test-only origins" >&2
    exit 1
  fi
}

# Guard: the SHOT_MODE build injects a content script that rewrites pages to
# redact personal data for screenshots. Useful for captures, catastrophic in a
# store: it edits what the user is reading.
guard_shot_mode() {
  local dir="$1"
  if grep -qr "shot-mode" "$dir" 2>/dev/null || grep -q "redactContent" "$dir/manifest.json"; then
    echo "REFUSING: $dir looks like a SHOT_MODE build" >&2
    exit 1
  fi
}

# Guard: the Chrome Web Store rejects the upload outright if manifest
# description exceeds 132 characters. It cost a round-trip at 133, and the
# message only arrives after the file has uploaded — so check before packaging.
guard_description_length() {
  local manifest="$1"
  python3 - "$manifest" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1])).get('description', '')
if len(d) > 132:
    print(f"REFUSING: manifest description is {len(d)} chars, limit 132", file=sys.stderr)
    print(f"  {d}", file=sys.stderr)
    sys.exit(1)
EOF
}

for target in chrome edge firefox; do
  echo "==> building $target"
  dir="dist/$DIST_PREFIX$target"
  BROWSER="$target" npx vite build --outDir "$dir" >/dev/null
  guard_test_origins "$dir/manifest.json"
  guard_shot_mode "$dir"
  guard_description_length "$dir/manifest.json"
  (cd "$dir" && zip -qr "../../$OUT/$NAME-$VERSION-$target.zip" .)
done

# Firefox reviewers require buildable source when the submission is minified.
echo "==> source archive for Firefox review"
git archive --format=zip --prefix="$NAME-$VERSION/" HEAD \
  -o "$OUT/$NAME-$VERSION-source.zip"

echo "==> refreshing Safari resources"
SAFARI_DIST="dist/${DIST_PREFIX}safari"
BROWSER=safari npx vite build --outDir "$SAFARI_DIST" >/dev/null
guard_test_origins "$SAFARI_DIST/manifest.json"
guard_shot_mode "$SAFARI_DIST"
if [ -d "$SAFARI_RES" ]; then
  rm -rf "${SAFARI_RES:?}/"*
  cp -R "$SAFARI_DIST"/* "$SAFARI_RES/"
  echo "    updated $SAFARI_RES"
else
  echo "    no Xcode project yet — create one with:"
  echo "    xcrun safari-web-extension-converter $SAFARI_DIST --project-location $SAFARI_PROJECT/"
fi

echo
ls -lh "$OUT"/"$NAME"-*
cat <<'EOF'

Next steps
  Chrome   upload the -chrome.zip at chrome.google.com/webstore/devconsole
  Edge     upload the -edge.zip at partner.microsoft.com/dashboard/microsoftedge
  Firefox  upload the -firefox.zip AND the -source.zip at addons.mozilla.org
  Safari   open the .xcodeproj under safari/ (Fetch) or safari-dd/ (DD) in Xcode,
           bump the build number,
           then Product > Archive > Distribute App

See docs/store-review.md for listing copy, permission justifications and the
per-store data-use declarations.
EOF
