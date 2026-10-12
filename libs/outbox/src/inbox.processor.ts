import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RmqContext } from '@nestjs/microservices';
import type { Channel, ConsumeMessage } from 'amqplib';
import { OUTBOX_DATABASE } from './database';
import type { SqlExecutor, TransactionalDatabase } from './database';
import { OutboxRelay } from './outbox.relay';

const MAX_ATTEMPTS = 3;

/**
 * Handles an incoming message using the "transactional inbox" pattern:
 *
 *   BEGIN
 *     INSERT INTO inbox_messages (message_id, handler)  ← duplicate? bail out
 *     … business logic + outgoing messages into the outbox …
 *   COMMIT
 *   ack
 *
 * The ack is sent only after the commit. If the process dies before the ack,
 * RabbitMQ redelivers the message and the inbox record prevents a second run.
 *
 * An error inside the transaction rolls everything back. First a few retries
 * (deadlock, serialization conflict, brief database outage), then a nack without
 * requeue — the message goes to delivery.dlx → q.dead-letter.
 */
@Injectable()
export class InboxProcessor {
  private readonly logger = new Logger(InboxProcessor.name);

  constructor(
    @Inject(OUTBOX_DATABASE) private readonly db: TransactionalDatabase,
    private readonly relay: OutboxRelay,
  ) {}

  /**
   * @param handler the handler name in the inbox; usually the message pattern
   * @param fn      business logic; receives the service transaction (Prisma TransactionClient)
   */
  async handle<Tx = SqlExecutor>(
    ctx: RmqContext,
    handler: string,
    fn: (tx: Tx) => Promise<void>,
  ): Promise<void> {
    const channel = ctx.getChannelRef() as Channel;
    const message = ctx.getMessage() as ConsumeMessage;
    const messageId = message.properties.messageId as string | undefined;

    if (!messageId) {
      this.logger.error(
        `${handler}: message without messageId — sent to the DLQ`,
      );
      channel.nack(message, false, false);
      return;
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const processed = await this.db.$transaction(async (tx) => {
          const inserted = await tx.$executeRaw`
            INSERT INTO inbox_messages (message_id, handler)
            VALUES (${messageId}, ${handler})
            ON CONFLICT DO NOTHING
          `;
          if (inserted === 0) return false;

          // Only the service knows the transaction type: each has its own Prisma client.
          await fn(tx as unknown as Tx);
          return true;
        });

        channel.ack(message);

        if (processed) {
          this.relay.wake();
        } else {
          this.logger.warn(
            `${handler}: duplicate ${messageId} — already processed, skipped`,
          );
        }
        return;
      } catch (e) {
        if (attempt === MAX_ATTEMPTS) {
          this.logger.error(
            `${handler}: ${messageId} failed after ${MAX_ATTEMPTS} attempts — sent to the DLQ`,
            e instanceof Error ? e.stack : String(e),
          );
          channel.nack(message, false, false);
          return;
        }

        this.logger.warn(
          `${handler}: attempt ${attempt} failed (${String(e)}), retrying`,
        );
        await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
      }
    }
  }
}
