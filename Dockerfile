FROM golang:1.24.5-alpine AS build

WORKDIR /src

RUN apk add --no-cache ca-certificates git

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o /out/slok-dashboard ./cmd/dashboard

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/slok-dashboard /slok-dashboard

EXPOSE 8080

USER nonroot:nonroot

ENTRYPOINT ["/slok-dashboard"]
