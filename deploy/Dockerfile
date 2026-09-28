# syntax=docker/dockerfile:1

FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY db ./db
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/snuarchive ./cmd/snuarchive

FROM alpine:3.22
RUN apk add --no-cache ca-certificates \
 && adduser -D -H -u 10001 app \
 && mkdir -p /data/uploads \
 && chown app /data/uploads
COPY --from=build /out/snuarchive /usr/local/bin/snuarchive
USER app
EXPOSE 8080
ENTRYPOINT ["snuarchive"]
CMD ["serve"]
