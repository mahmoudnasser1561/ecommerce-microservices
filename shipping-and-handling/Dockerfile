FROM golang:1.23-alpine AS build

WORKDIR /app

ENV PATH="/usr/local/go/bin:${PATH}"

# Copy source
COPY . .

RUN test -f go.mod || go mod init shipping-and-handling
RUN go get github.com/prometheus/client_golang/prometheus/promhttp
RUN go mod tidy

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o shipping-and-handling .

FROM alpine:3.20

WORKDIR /app
COPY --from=build /app/shipping-and-handling /app/shipping-and-handling

EXPOSE 8080
CMD ["/app/shipping-and-handling"]