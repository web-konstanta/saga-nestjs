/**
 * Runs a Prisma CLI command for every service that owns a database.
 *
 *   yarn db generate                          → prisma generate × 5
 *   yarn db migrate deploy                    → apply migrations everywhere
 *   yarn db migrate dev --name add_x --only=orders
 *   yarn db db seed --only=inventory,couriers --reset
 *
 * --only=a,b limits the list of services; everything else goes to prisma as is.
 * The exception is `db seed`: the remaining flags go to the seed script. A "--"
 * separator is unreliable: yarn 1 swallows it along the way.
 */
import { spawnSync } from 'child_process';

const SERVICES = [
  'orders',
  'inventory',
  'payments',
  'couriers',
  'notifications',
];

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only='));
const prismaArgs = args.filter((a) => a !== onlyArg);

const services = onlyArg
  ? onlyArg
      .slice('--only='.length)
      .split(',')
      .map((s) => s.trim())
  : SERVICES;

const unknown = services.filter((s) => !SERVICES.includes(s));
if (unknown.length > 0 || prismaArgs.length === 0) {
  console.error(
    unknown.length > 0
      ? `unknown services: ${unknown.join(', ')}`
      : 'usage: yarn db <prisma command> [--only=service,…]',
  );
  process.exit(1);
}

const isSeed = prismaArgs[0] === 'db' && prismaArgs[1] === 'seed';
const command = isSeed ? prismaArgs.slice(0, 2) : prismaArgs;
const seedArgs = isSeed ? prismaArgs.slice(2).filter((a) => a !== '--') : [];

for (const service of services) {
  console.log(`\n── ${service}: prisma ${[...command, ...seedArgs].join(' ')}`);
  const result = spawnSync(
    'prisma',
    [
      ...command,
      '--config',
      `apps/${service}/prisma.config.ts`,
      ...(seedArgs.length > 0 ? ['--', ...seedArgs] : []),
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
