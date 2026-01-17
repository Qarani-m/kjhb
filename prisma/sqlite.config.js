import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  datasource: {
    // SQLite connection URL
    url: env("SQLITE_DATABASE_URL"),
  },
  migrate: {
    datasourceUrl: env("SQLITE_DATABASE_URL"),
  },
});
