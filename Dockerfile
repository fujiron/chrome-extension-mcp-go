FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy go.mod and go.sum
COPY go.mod ./

# Download dependencies
RUN go mod download

# Copy the source code
COPY *.go ./

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o chrome-extension-mcp-go .

# Create extension directory
COPY extension /app/extension

# Runtime stage
FROM alpine:latest

WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/chrome-extension-mcp-go .
COPY --from=builder /app/extension ./extension

# Run the application
ENTRYPOINT ["./chrome-extension-mcp-go"]
