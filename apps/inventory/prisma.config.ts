import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node apps/inventory/prisma/seed.ts',
  },
  datasource: { url: process.env.INVENTORY_DATABASE_URL },
});
