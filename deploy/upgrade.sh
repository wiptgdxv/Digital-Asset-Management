#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_DIR=$(dirname "$SCRIPT_DIR")
ENV_FILE="$RELEASE_DIR/.env.production"
TARGET_VERSION=1.0.6
ARCHIVE="$RELEASE_DIR/images-linux-amd64-$TARGET_VERSION.tar"

[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE" >&2; exit 1; }
[ -f "$ARCHIVE" ] || { echo "Missing $ARCHIVE" >&2; exit 1; }

cp -p "$ENV_FILE" "$ENV_FILE.before-$TARGET_VERSION"
sed -i "s/^IMAGE_VERSION=.*/IMAGE_VERSION=$TARGET_VERSION/" "$ENV_FILE"

exec sh "$SCRIPT_DIR/deploy.sh"
