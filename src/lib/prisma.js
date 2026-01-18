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
        `Attempting to connect to Neon PostgreSQL (Attempt ${
          retryCount + 1
        }/${maxRetries})...`
      );

      if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL environment variable is not set");
      }

      const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 10000,
        max: 10,
      });

      // Test the actual connection
      await pool.query('SELECT 1');

      const adapter = new PrismaPg(pool);
      const pgClient = new PrismaClient({ adapter });

      await pgClient.$connect();
      console.log("Connected to Neon PostgreSQL successfully.");
      prismaInstance = pgClient;
      return prismaInstance;
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

export const prisma = await getPrisma();
