# Use Node.js 20 slim as base image
FROM node:20-slim@sha256:6c51af7dc83f4708aaac35991306bca8f478351cfd2bda35750a62d7efcf05bb AS builder

# Install OpenSSL (required for Prisma)
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including Prisma CLI)
RUN npm ci --include=dev

# Copy source code and Prisma schemas
COPY . .

# Set environment variables for Prisma generation
ENV SQLITE_DATABASE_URL="file:./dev.db"
ENV DATABASE_URL=""

# Generate Prisma clients with their respective configs
# PostgreSQL client uses prisma.config.js (reads DATABASE_URL)
# SQLite client uses prisma/sqlite.config.js (reads SQLITE_DATABASE_URL)
RUN npx prisma generate --schema=./prisma/schema.prisma --config=./prisma.config.js || true && \
    npx prisma generate --schema=./prisma/sqlite.prisma --config=./prisma/sqlite.config.js

# Final stage
FROM node:20-slim@sha256:6c51af7dc83f4708aaac35991306bca8f478351cfd2bda35750a62d7efcf05bb

# Install OpenSSL
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy everything from builder
COPY --from=builder /app /app

# Set SQLite URL for runtime (will be used when PostgreSQL is unavailable)
ENV SQLITE_DATABASE_URL="file:./dev.db"

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]