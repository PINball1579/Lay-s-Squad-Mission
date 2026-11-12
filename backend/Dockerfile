# syntax=docker/dockerfile:1
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
COPY . .
RUN --mount=type=secret,id=proxy_ca,required=true \
    SSL_CERT_FILE=/run/secrets/proxy_ca CGO_ENABLED=0 \
    go build -trimpath -ldflags='-s -w' -o /out/crunch-api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/crunch-api /crunch-api
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/crunch-api"]

