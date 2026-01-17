import pkg from "@prisma/client";
const { PrismaClient } = pkg;
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

let output = "";
const log = (msg) => {
  console.log(msg);
  output += msg + "\n";
};

try {
  log("Testing Prisma initialization...");
  const prisma = new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
  });
  log("Prisma initialized successfully!");
  await prisma.$connect();
  log("Connected to database!");
  await prisma.$disconnect();
} catch (e) {
  log("Initialization Failed:");
  log(e.message);
  log(JSON.stringify(e, null, 2));
  if (e.stack) log(e.stack);
}

fs.writeFileSync("prisma-test-result.txt", output);
