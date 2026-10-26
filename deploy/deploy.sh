#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RELEASE_DIR=$(dirname "$SCRIPT_DIR")
ENV_FILE="$RELEASE_DIR/.env.production"
COMPOSE_FILE="$RELEASE_DIR/compose.production.yaml"

if [ "$(uname -m)" != "x86_64" ] && [ "$(uname -m)" != "amd64" ]; then
    echo "Unsupported architecture: $(uname -m). This package requires x86_64/AMD64." >&2
    exit 1
fi

command -v docker >/dev/null 2>&1 || { echo 'Docker is required.' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo 'Docker Compose v2 is required.' >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE." >&2; exit 1; }

IMAGE_VERSION=$(sed -n 's/^IMAGE_VERSION=//p' "$ENV_FILE" | tail -n 1)
[ -n "$IMAGE_VERSION" ] || { echo 'IMAGE_VERSION is missing in .env.production.' >&2; exit 1; }
ARCHIVE="$RELEASE_DIR/images-linux-amd64-$IMAGE_VERSION.tar"
[ -f "$ARCHIVE" ] || { echo "Missing image archive: $ARCHIVE" >&2; exit 1; }

docker load --input "$ARCHIVE"

for IMAGE in "digital-assets-backend:$IMAGE_VERSION" "digital-assets-frontend:$IMAGE_VERSION" 'postgres:17-alpine'; do
    PLATFORM=$(docker image inspect "$IMAGE" --format '{{.Os}}/{{.Architecture}}')
    [ "$PLATFORM" = 'linux/amd64' ] || { echo "$IMAGE has unexpected platform: $PLATFORM" >&2; exit 1; }
done

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo "Deployment started. Check the HTTP endpoint and logs before announcing availability."
