# Build binaries
FROM golang:1.24.2-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 \
    go build -o /out/validate       ./cmd/validate && \
    go build -o /out/publish-scans  ./cmd/publish-scans && \
    go build -o /out/dry-run        ./cmd/dry-run

# Run binaries
FROM gcr.io/distroless/static
COPY --from=build /out/validate /validate
COPY --from=build /out/publish-scans /publish-scans
COPY --from=build /out/dry-run /dry-run
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
