import { db } from "./db.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function initializeSchema() {
  console.log("Initializing Neon PostgreSQL database schema...");

  try {
    const schemaPath = join(__dirname, "../../postgres-schema.sql");
    const schema = readFileSync(schemaPath, "utf-8");

    // Split by semicolons and execute each statement
    const statements = schema
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await db.query(statement);
    }

    console.log("Neon PostgreSQL schema initialized successfully.");
  } catch (error) {
    console.error("Error initializing Neon PostgreSQL schema:", error);
    throw error;
  }
}
