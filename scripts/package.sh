#!/bin/bash
# Assemble the Volumio plugin zip: the plugin directory's files at the root of
# the zip as Volumio's plugin manager expects, the licence, and the node modules.
# Output: dist/display_configuration-<version>.zip. The repository's own files
# (tests, scripts, workflows, docs) are outside plugin/ and stay out.
set -euo pipefail
ROOT=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
PLUGIN=$ROOT/plugin
VERSION=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$PLUGIN/package.json" | head -n1)
[ -n "$VERSION" ] || { echo "package: no version in plugin/package.json" >&2; exit 1; }
NAME=display_configuration
STAGE=$ROOT/dist/stage/$NAME
rm -rf "$ROOT/dist/stage"
mkdir -p "$STAGE" "$ROOT/dist"

cp -r "$PLUGIN/." "$STAGE/"
cp "$ROOT/LICENSE" "$STAGE/LICENSE"
chmod 755 "$STAGE/install.sh" "$STAGE/uninstall.sh"

# The build the zip carries: the commit and the time.
printf '{ "commit": "%s", "built": "%s" }\n' \
  "$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STAGE/build.json"

# Node modules: with npm on this machine, directly; otherwise in a container.
# A failure here is a failure: a zip without its modules installs and then does not load.
if command -v npm >/dev/null 2>&1; then
  ( cd "$STAGE" && npm install --omit=dev --no-audit --no-fund --loglevel=error >/dev/null )
else
  docker run --rm -v "$STAGE:/plugin" -w /plugin node:20-slim \
    sh -c "npm install --omit=dev --no-audit --no-fund --loglevel=error >/dev/null && chown -R $(id -u):$(id -g) /plugin"
fi
rm -f "$STAGE/package-lock.json"
for module in fs-extra kew v-conf; do
  [ -f "$STAGE/node_modules/$module/package.json" ] || { echo "package: module $module missing after npm install" >&2; exit 1; }
done

( cd "$STAGE" && rm -f "$ROOT/dist/$NAME-$VERSION.zip" && zip -qr "$ROOT/dist/$NAME-$VERSION.zip" . )
rm -rf "$ROOT/dist/stage"
ls -la "$ROOT/dist/$NAME-$VERSION.zip"
