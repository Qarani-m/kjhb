import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaLibSql } from "@prisma/adapter-libsql";
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
        }/${maxRetries})...`,
      );
      const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5000,
      });
      const adapter = new PrismaPg(pool);
      const pgClient = new PrismaClient({ adapter });

      // Test the connection
      await pgClient.$connect();
      // Explicitly run a query to ensure the connection is truly active and ready
      await pgClient.$queryRaw`SELECT 1`;
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
    "All PostgreSQL connection attempts failed. Falling back to SQLite...",
  );

  try {
    // Attempt to initialize a SQLite client using libSQL adapter
    let SqlitePrismaClient;
    try {
      // Try to import the generated SQLite client
      const module =
        await import("../../prisma/generated/sqlite-client/index.js");
      SqlitePrismaClient = module.PrismaClient;
      console.log("Using generated SQLite Prisma Client.");
    } catch (e) {
      console.warn(
        "Could not load generated SQLite client, falling back to default PrismaClient (might fail if providers mismatch):",
        e.message,
      );
      SqlitePrismaClient = PrismaClient;
    }

    // Create libSQL adapter with config
    const adapter = new PrismaLibSql({
      url: process.env.SQLITE_DATABASE_URL || "file:./dev.db",
    });

    // Create Prisma client with adapter
    const sqliteClient = new SqlitePrismaClient({ adapter });

    await sqliteClient.$connect();
    console.log("Connected to SQLite successfully.");
    prismaInstance = sqliteClient;
    return prismaInstance;
  } catch (error) {
    console.error(
      "FATAL: Failed to connect to fallback SQLite database.",
      error.message,
    );
    throw error;
  }
}

// Export the prisma instance
export const prisma = await getPrisma();
