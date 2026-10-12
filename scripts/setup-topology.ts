import * as amqp from 'amqplib';

const EXCHANGE = 'delivery.events';
const DLX = 'delivery.dlx';

const QUEUES = [
  // saga orchestrator: the create command + every participant reply
  { name: 'q.orders', bindings: ['orders.*'] },
  { name: 'q.inventory', bindings: ['inventory.*'] },
  { name: 'q.payments', bindings: ['payments.*'] },
  { name: 'q.couriers', bindings: ['couriers.*'] },
  // domain events for the outside world: order.confirmed / order.cancelled
  { name: 'q.notifications', bindings: ['order.*'] },
];

/**
 * Bindings from the old layout that must be removed. bindQueue does not delete
 * old bindings, so without this q.orders would keep receiving order.confirmed
 * and dead-lettering it: the orchestrator has no handler for it.
 * unbindQueue is idempotent — if the binding is already gone, the call does nothing.
 */
const STALE_BINDINGS = [{ queue: 'q.orders', key: 'order.*' }];

async function main() {
  const url = process.env.RABBITMQ_URL!;
  const conn = await amqp.connect(url);
  const ch = await conn.createChannel();

  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertExchange(DLX, 'topic', { durable: true });

  await ch.assertQueue('q.dead-letter', { durable: true });
  await ch.bindQueue('q.dead-letter', DLX, '#');
  console.log(`q.dead-letter ← # (from ${DLX})`);

  for (const q of QUEUES) {
    await ch.assertQueue(q.name, { durable: true, deadLetterExchange: DLX });
    for (const key of q.bindings) {
      await ch.bindQueue(q.name, EXCHANGE, key);
      console.log(`${q.name} ← ${key}`);
    }
  }

  for (const stale of STALE_BINDINGS) {
    await ch.unbindQueue(stale.queue, EXCHANGE, stale.key);
    console.log(`${stale.queue} ⊘ ${stale.key} (stale binding removed)`);
  }

  await ch.close();
  await conn.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
