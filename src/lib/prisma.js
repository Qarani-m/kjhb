import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

let prismaInstance;

async function getPrisma() {
  if (prismaInstance) return prismaInstance;
  const maxRetries = 4;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      console.log(
        `Attempting to connect to PostgreSQL (Attempt ${
          retryCount + 1
        }/${maxRetries})...`
      );
      const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5000,
      });

      // Test the actual connection
      await pool.query('SELECT 1');

      const adapter = new PrismaPg(pool);
      const pgClient = new PrismaClient({ adapter });

      await pgClient.$connect();
      console.log("Connected to PostgreSQL successfully.");
      prismaInstance = pgClient;
      return prismaInstance;
    } catch (error) {
      retryCount++;
      console.error(`PostgreSQL connection failed: ${error.message}`);
      if (retryCount < maxRetries) {
        console.log(`Retrying in 2 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  console.warn(
    "All PostgreSQL connection attempts failed. Falling back to SQLite..."
  );
  try {
    // Override DATABASE_URL for SQLite
    process.env.DATABASE_URL = process.env.SQLITE_DATABASE_URL || "file:./database.db";

    const sqliteClient = new PrismaClient();
    await sqliteClient.$connect();
    console.log("Connected to SQLite successfully.");
    prismaInstance = sqliteClient;
    return prismaInstance;
  } catch (error) {
    console.error(
      "FATAL: Failed to connect to fallback SQLite database.",
      error.message
    );
    throw error;
  }
}

export const prisma = await getPrisma();
