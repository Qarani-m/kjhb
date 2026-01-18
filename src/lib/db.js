import pkg from "pg";
const { Pool } = pkg;
import dotenv from "dotenv";

dotenv.config();

let db;

async function initializeDatabase() {
  const maxRetries = 4;
  let retryCount = 0;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  while (retryCount < maxRetries) {
    try {
      console.log(
        `Attempting to connect to Neon PostgreSQL (Attempt ${
          retryCount + 1
        }/${maxRetries})...`
      );

      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 10000,
        max: 10,
        idleTimeoutMillis: 30000,
      });

      // Test the connection
      await pool.query("SELECT 1");
      console.log("Connected to Neon PostgreSQL successfully.");

      db = pool;
      return;
    } catch (error) {
      retryCount++;
      console.error(`Neon PostgreSQL connection failed: ${error.message}`);
      if (retryCount < maxRetries) {
        const delay = 2000 * retryCount; // Exponential backoff
        console.log(`Retrying in ${delay / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.error(
    "FATAL: Failed to connect to Neon PostgreSQL after all retries."
  );
  throw new Error("Unable to connect to Neon PostgreSQL database");
}

// Query function for PostgreSQL
export async function query(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows;
}

// Get single row
export async function queryOne(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

// Execute a query (INSERT/UPDATE/DELETE) and return metadata
export async function execute(sql, params = []) {
  const result = await db.query(sql, params);
  return {
    rowCount: result.rowCount,
    rows: result.rows,
    insertId: result.rows[0]?.id,
  };
}

// Transaction support
export async function transaction(callback) {
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
}

// Initialize database on module load
await initializeDatabase();

export { db };
