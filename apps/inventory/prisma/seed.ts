/**
 * Demo warehouse. Idempotent: existing items are left alone so that re-seeding
 * does not wipe live stock. `yarn db:seed:reset` restores the initial stock levels.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const STOCK: [sku: string, available: number][] = [
  ['ABC-1', 10],
  ['ABC-2', 5],
  ['RARE', 1],
  ['OUT', 0],
];

const reset = process.argv.includes('--reset');

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.INVENTORY_DATABASE_URL!,
    }),
  });

  try {
    for (const [sku, available] of STOCK) {
      await prisma.stockItem.upsert({
        where: { sku },
        create: { sku, available },
        update: reset ? { available } : {},
      });
    }
    console.log(
      `inventory: stock ${reset ? 'reset' : 'seeded'}: ${STOCK.length} SKUs`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
