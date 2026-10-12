import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node apps/couriers/prisma/seed.ts',
  },
  datasource: { url: process.env.COURIERS_DATABASE_URL },
});
