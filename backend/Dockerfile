# syntax=docker/dockerfile:1.7
ARG GO_VERSION=1.27.2

FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/asset-api . \
    && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 assets \
    && adduser -S -D -H -u 10001 -G assets assets \
    && mkdir -p /app/etc /data/uploads \
    && chown -R assets:assets /app /data/uploads

COPY --from=build --chown=assets:assets /out/asset-api /app/asset-api
COPY --from=build --chown=assets:assets /out/migrate /app/migrate
COPY --chown=assets:assets backend/etc/asset-api.production.yaml /app/etc/asset-api.yaml

USER assets
WORKDIR /app
EXPOSE 8888
VOLUME ["/data/uploads"]
ENTRYPOINT ["/app/asset-api"]
CMD ["-f", "/app/etc/asset-api.yaml"]
