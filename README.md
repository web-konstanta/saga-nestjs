# Delivery · NestJS microservices

Order checkout as a saga on top of RabbitMQ. Six services, each with its own
Postgres database (database per service); reliable messaging via a
transactional outbox and inbox.

```
 HTTP ──▶ gateway ──▶ orders (saga orchestrator) ──▶ inventory ─┐
                          ▲    ▲         │            payments  ─┤ replies
                          │    │         └──────────▶ couriers  ─┘
                          │    └─ order.confirmed / order.cancelled ──▶ notifications
                     GET /sagas (observability)
```

| Service | Port / queue | Database | What it stores |
|---|---|---|---|
| gateway | HTTP :3000 | — | nothing: validates the request and publishes `orders.create`; proxies `GET /sagas` to orders |
| orders | HTTP :3001 (internal), `q.orders` | `orders_db` | sagas, their history and step deadlines |
| inventory | `q.inventory` | `inventory_db` | stock and reservations |
| payments | `q.payments` | `payments_db` | accounts and payments |
| couriers | `q.couriers` | `delivery_db` | couriers and assignments |
| notifications | `q.notifications` | `notifications_db` | notifications sent |

## Quick start

```bash
cp .env.example .env
yarn install          # postinstall generates the Prisma Client for every service
yarn setup            # docker compose + RabbitMQ topology + migrations + seeds
yarn start:all        # all six services in watch mode
```

Try it: `curl -X POST localhost:3000/orders -H 'Content-Type: application/json' -d '{"customerId":"c-1","address":"Kyiv","items":[{"sku":"ABC-1","qty":1,"priceCents":1000}]}'`,
then `curl localhost:3000/sagas/<sagaId>` (the gateway proxies it to orders). The storefront and the E2E bench live in the sibling `../frontend`.

## Database (Prisma 7)

Each service has its own schema and migrations:

```
apps/<service>/prisma.config.ts        ← database URL from <SERVICE>_DATABASE_URL
apps/<service>/prisma/schema.prisma
apps/<service>/prisma/migrations/
apps/<service>/src/generated/prisma/   ← generated client (in .gitignore)
```

| Command | What it does |
|---|---|
| `yarn db:generate` | generate the Prisma Client for every service |
| `yarn db:migrate` | apply migrations everywhere (`migrate deploy`, for CI/production) |
| `yarn db:status` | migration status across all databases |
| `yarn db:seed` | seed stock and couriers without touching live data |
| `yarn db:seed:reset` | restore initial stock and free every courier |
| `yarn db migrate dev --name <name> --only=<service>` | a new migration after a schema change |
| `yarn db <any prisma command> [--only=a,b]` | any Prisma CLI command, per service |

Constraints Prisma's schema language cannot express (CHECKs on non-negative
stock and balances) are added to the migration SQL by hand: create the
migration with `--create-only`, edit the SQL, then apply it.

## Reliable messaging

A service cannot atomically "write to the database and send to RabbitMQ" —
they are two separate systems. So no service publishes to the broker directly
from business logic (the exception is the gateway, which has no state).

**Transactional outbox** (`libs/outbox`). An outgoing message is written as a
row in `outbox_messages` in the same transaction as the business data
(`OutboxWriter.add(tx, …)`). Commit — both the data and the message are saved;
rollback — neither is. The background `OutboxRelay` claims unsent rows
(`FOR UPDATE SKIP LOCKED`, a `locked_until` lease), publishes them with
publisher confirms and sets `published_at`. The relay is woken right after each
commit, so latency does not depend on the polling interval. While the broker is
down, messages pile up in the table and are sent later with exponential backoff.

**Transactional inbox** (`InboxProcessor`). An incoming message is handled like this:

```
BEGIN
  INSERT INTO inbox_messages (message_id, handler) ON CONFLICT DO NOTHING  ← duplicate? bail out
  business logic + OutboxWriter.add(...)
COMMIT
ack
```

The ack is sent only after the commit. If the process dies before the ack, the
broker redelivers the message and the inbox record prevents processing it
twice. On errors — up to three attempts, then a nack to `q.dead-letter`.

**Business-level idempotency.** Every saga command carries an `idempotencyKey`;
the outcome (including a rejection) is stored under a unique key in
`reservations` / `payments` / `courier_assignments`, so a repeated command gets
the previous reply without changing any data.

**The resulting guarantee is effectively-once**: at-least-once delivery plus
deduplication by `messageId` and `idempotencyKey`.

## Saga and timeouts

The orchestrator (`apps/orders/src/saga.orchestrator.ts`) handles each message
in a transaction with the saga row locked (`SELECT … FOR UPDATE`): a
participant's reply and a timeout for the same saga never recompute it at the
same time.

A step timer is the `sagas.deadline_at` column, not `setTimeout`: it survives
restarts and works across several orders instances. `SagaTimeoutWatcher` looks
for expired steps once a second and starts a rollback with reason `TIMEOUT`; a
timeout of the rollback itself moves the saga to `STUCK`.

**Late replies.** If a participant replies with success after the timeout (the
saga is rolling back or cancelled, and the resource is not recorded in it), the
orchestrator sends a dedicated compensation for that resource: release the
reservation, refund the payment, free the courier. Otherwise the resource would
leak forever.

## Operations

```sql
-- messages stuck in the outbox (broker unavailable, publish errors)
SELECT routing_key, attempts, last_error, created_at
FROM outbox_messages WHERE published_at IS NULL ORDER BY created_at;

-- sagas that need manual review
SELECT id, awaiting, failure_reason, updated_at FROM sagas WHERE status = 'STUCK';
```

Messages that failed three attempts sit in `q.dead-letter` — inspect them in
RabbitMQ Management (`localhost:15672`). Sent outbox rows and inbox records
older than `OUTBOX_RETENTION_DAYS` (7 by default) are deleted automatically
once an hour.

All settings and their defaults are listed in `.env.example`.

## Tests

```bash
yarn test     # unit: the orchestrator on fake repository and outbox, no database
yarn lint
```

## Known limitations

- **POST /orders is not idempotent.** If the gateway response is lost and the
  client retries, a second order is created. The fix is an `Idempotency-Key` header.
- **The gateway has no outbox.** With the broker down it responds with an error
  and the client has to retry. The order is not lost silently, but not accepted either.
- **Couriers are never released after delivery** — the domain has no "delivered"
  step. For the demo, reset the pool with `yarn db:seed:reset`.
- **No health endpoints or metrics** (outbox backlog, queue depth) — the first
  thing a container orchestrator and alerting will need.
- **The dead-letter queue is handled manually**: there is no tool to replay messages from the DLQ.
