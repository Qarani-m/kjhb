import pkg from "pg";
const { Pool } = pkg;
import sqlite3 from "sqlite3";
import { promisify } from "util";
import dotenv from "dotenv";

dotenv.config();

let db;
let dbType; // 'postgres' or 'sqlite'

async function initializeDatabase() {
  const maxRetries = 4;
  let retryCount = 0;

  // Try PostgreSQL first
  while (retryCount < maxRetries) {
    try {
      console.log(
        `Attempting to connect to PostgreSQL (Attempt ${
          retryCount + 1
        }/${maxRetries})...`
      );

      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5000,
      });

      // Test the connection
      await pool.query("SELECT 1");
      console.log("Connected to PostgreSQL successfully.");

      dbType = "postgres";
      db = pool;
      return;
    } catch (error) {
      retryCount++;
      console.error(`PostgreSQL connection failed: ${error.message}`);
      if (retryCount < maxRetries) {
        console.log(`Retrying in 2 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  // Fallback to SQLite
  console.warn(
    "All PostgreSQL connection attempts failed. Falling back to SQLite..."
  );

  try {
    const dbPath = process.env.SQLITE_DATABASE_URL?.replace("file:", "") || "./dev.db";
    const sqliteDb = new sqlite3.Database(dbPath);

    // Promisify sqlite3 methods for easier async/await usage
    db = {
      run: promisify(sqliteDb.run.bind(sqliteDb)),
      get: promisify(sqliteDb.get.bind(sqliteDb)),
      all: promisify(sqliteDb.all.bind(sqliteDb)),
      exec: promisify(sqliteDb.exec.bind(sqliteDb)),
      close: promisify(sqliteDb.close.bind(sqliteDb)),
      _raw: sqliteDb,
    };

    dbType = "sqlite";
    console.log("Connected to SQLite successfully.");
  } catch (error) {
    console.error(
      "FATAL: Failed to connect to fallback SQLite database.",
      error.message
    );
    throw error;
  }
}

// Query function that works with both databases
export async function query(sql, params = []) {
  if (dbType === "postgres") {
    const result = await db.query(sql, params);
    return result.rows;
  } else {
    // SQLite - handle parameterized queries
    if (params.length > 0) {
      return await db.all(sql, params);
    }
    return await db.all(sql);
  }
}

// Get single row
export async function queryOne(sql, params = []) {
  if (dbType === "postgres") {
    const result = await db.query(sql, params);
    return result.rows[0] || null;
  } else {
    if (params.length > 0) {
      return await db.get(sql, params);
    }
    return await db.get(sql);
  }
}

// Execute a query (INSERT/UPDATE/DELETE) and return metadata
export async function execute(sql, params = []) {
  if (dbType === "postgres") {
    const result = await db.query(sql, params);
    return {
      rowCount: result.rowCount,
      rows: result.rows,
      insertId: result.rows[0]?.id,
    };
  } else {
    await db.run(sql, params);
    return {
      rowCount: db._raw.changes,
      insertId: db._raw.lastID,
    };
  }
}

// Transaction support
export async function transaction(callback) {
  if (dbType === "postgres") {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } else {
    // SQLite transactions
    try {
      await db.run("BEGIN TRANSACTION");
      const result = await callback(db);
      await db.run("COMMIT");
      return result;
    } catch (error) {
      await db.run("ROLLBACK");
      throw error;
    }
  }
}

// Export the database type so queries can be adapted if needed
export function getDbType() {
  return dbType;
}

// Initialize database on module load
await initializeDatabase();

export { db };
