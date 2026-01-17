import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  datasource: {
    // PostgreSQL connection URL
    url: env("DATABASE_URL"),
  },
  migrate: {
    datasourceUrl: env("DATABASE_URL"),
  },
});
