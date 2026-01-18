# Migration to Neon PostgreSQL

This document outlines the changes made to switch from SQLite fallback to exclusive Neon PostgreSQL usage.

## Changes Made

### 1. Database Connection Files

#### `src/lib/prisma.js`
- Removed SQLite fallback logic
- Now exclusively connects to Neon PostgreSQL
- Added proper error validation for missing DATABASE_URL
- Implemented exponential backoff for retries
- Increased connection timeout to 10 seconds
- Added connection pool configuration (max: 10 connections)

#### `src/lib/db.js`
- Removed all SQLite-related code
- Removed `getDbType()` function (no longer needed)
- Simplified to PostgreSQL-only implementation
- Removed conditional logic for database type
- Updated all query functions to PostgreSQL-only

#### `src/lib/init-db.js`
- Removed SQLite schema initialization
- Now only uses `postgres-schema.sql`
- Removed conditional logic for database type

### 2. Dependencies

#### `package.json`
Removed:
- `sqlite3`
- `@libsql/client`

Kept:
- `@prisma/adapter-pg` (PostgreSQL adapter)
- `@prisma/client` (Prisma ORM)
- `pg` (PostgreSQL client)

### 3. Environment Configuration

#### `.env`
- Removed `SQLITE_DATABASE_URL` variable
- Added comment indicating Neon PostgreSQL usage
- DATABASE_URL should be set to your Neon connection string

Example Neon connection string format:
```
DATABASE_URL="postgresql://user:password@ep-xxxxx.region.aws.neon.tech/dbname?sslmode=require"
```

### 4. Docker Configuration

#### `Dockerfile`
- Removed SQLite-related environment variables
- Removed SQLite Prisma client generation
- Simplified to single Prisma generate command
- Removed SQLite runtime environment variable

#### `docker-compose.yml`
- Removed `SQLITE_URL` environment variable
- Removed `./data:/app/data` volume mount (was for SQLite)
- Kept uploads volume mount

### 5. Cleaned Up Files

Deleted:
- `database.db` - SQLite database file
- `dev.db` - SQLite development database
- `sqlite-schema.sql` - SQLite schema definition

Kept:
- `postgres-schema.sql` - PostgreSQL schema (active)

## Setup Instructions

### For Local Development

1. **Get a Neon Database**
   - Sign up at https://neon.tech
   - Create a new project
   - Copy your connection string

2. **Update .env file**
   ```bash
   DATABASE_URL="your-neon-connection-string"
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Initialize the database schema**
   The schema will be automatically initialized when the app starts via `initializeSchema()` in `src/index.js`

5. **Start the application**
   ```bash
   npm start
   ```

### For Docker Deployment

1. **Update docker-compose.yml** (if using Neon instead of local PostgreSQL)
   ```yaml
   environment:
     - DATABASE_URL=your-neon-connection-string
   ```

2. **Build and run**
   ```bash
   docker-compose up --build
   ```

### For Production

1. Set the `DATABASE_URL` environment variable to your Neon production connection string
2. Neon handles connection pooling, SSL, and scalability automatically
3. The application will retry connection attempts with exponential backoff

## Benefits of Neon PostgreSQL

- **Serverless**: Scales to zero when not in use
- **Branching**: Create database branches for development/testing
- **Auto-scaling**: Handles traffic spikes automatically
- **Built-in connection pooling**: No additional pooler needed
- **SSL by default**: Secure connections out of the box
- **Managed backups**: Automatic point-in-time recovery
- **Global deployment**: Low latency worldwide

## Connection Retry Logic

The application implements robust retry logic:
- 4 retry attempts
- Exponential backoff (2s, 4s, 6s, 8s)
- 10-second connection timeout
- Connection pool with max 10 connections
- 30-second idle timeout

## Troubleshooting

### Connection Issues

1. **Verify DATABASE_URL is set correctly**
   ```bash
   echo $DATABASE_URL
   ```

2. **Check Neon dashboard** for database status

3. **Test connection directly**
   ```bash
   psql $DATABASE_URL -c "SELECT 1"
   ```

4. **Check firewall/network settings** - Neon requires outbound HTTPS

### Schema Issues

If tables are missing, the schema initializes automatically on first run. Check logs for:
```
Initializing Neon PostgreSQL database schema...
Neon PostgreSQL schema initialized successfully.
```

## Migration Checklist

- [x] Remove SQLite fallback from prisma.js
- [x] Remove SQLite fallback from db.js
- [x] Update init-db.js to PostgreSQL-only
- [x] Remove SQLite dependencies
- [x] Update environment variables
- [x] Clean up SQLite files
- [x] Update Docker configuration
- [x] Test database connection
- [x] Verify schema initialization

## Notes

- No data migration needed (fresh setup)
- All existing code using `query()`, `queryOne()`, `execute()`, and `transaction()` functions will work without changes
- The PostgreSQL schema is maintained in `postgres-schema.sql`
