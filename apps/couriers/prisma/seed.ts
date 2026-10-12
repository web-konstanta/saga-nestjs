/**
 * Demo courier pool. Idempotent: busy couriers are not freed.
 * `yarn db:seed:reset` frees the whole pool.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/** A small pool: a third concurrent order will not find a courier. */
const COURIERS: [id: string, name: string][] = [
  ['crr-1', 'Oleh'],
  ['crr-2', 'Maryna'],
];

const reset = process.argv.includes('--reset');

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.COURIERS_DATABASE_URL!,
    }),
  });

  try {
    for (const [id, name] of COURIERS) {
      await prisma.courier.upsert({
        where: { id },
        create: { id, name },
        update: reset ? { name, currentOrderId: null } : { name },
      });
    }
    console.log(
      `couriers: pool ${reset ? 'reset' : 'seeded'} (${COURIERS.length} couriers)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
