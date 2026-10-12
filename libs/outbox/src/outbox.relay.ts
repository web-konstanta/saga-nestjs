import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RabbitPublisher } from '@app/messaging';
import { OUTBOX_DATABASE } from './database';
import type { TransactionalDatabase } from './database';

interface ClaimedMessage {
  id: string;
  routingKey: string;
  payload: unknown;
  createdAt: Date | string;
  attempts: number;
}

const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The relay (a.k.a. message relay / outbox publisher): moves messages from the
 * outbox_messages table to RabbitMQ.
 *
 * The guarantee is at-least-once. If the process dies between publishing and
 * setting published_at, the lease (locked_until) expires and the message is sent
 * again with the same messageId — the receiver drops the duplicate via its inbox.
 *
 * Several service instances are safe: rows are claimed with
 * FOR UPDATE SKIP LOCKED, and each one is leased by exactly one relay.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);

  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly leaseMs: number;
  private readonly retentionDays: number;

  private timer?: NodeJS.Timeout;
  private housekeeping?: NodeJS.Timeout;
  private running = false;
  private rerun = false;
  private stopped = false;

  constructor(
    @Inject(OUTBOX_DATABASE) private readonly db: TransactionalDatabase,
    private readonly publisher: RabbitPublisher,
    config: ConfigService,
  ) {
    this.pollIntervalMs = Number(config.get('OUTBOX_POLL_INTERVAL_MS', 1000));
    this.batchSize = Number(config.get('OUTBOX_BATCH_SIZE', 100));
    this.leaseMs = Number(config.get('OUTBOX_LEASE_MS', 30_000));
    this.retentionDays = Number(config.get('OUTBOX_RETENTION_DAYS', 7));
  }

  onApplicationBootstrap() {
    this.schedule(0);
    this.housekeeping = setInterval(
      () => void this.cleanup(),
      HOUSEKEEPING_INTERVAL_MS,
    );
    this.housekeeping.unref();
  }

  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.housekeeping);
  }

  /**
   * Asks to flush the outbox right now instead of waiting for the next poll.
   * Called after the transaction that wrote the messages commits — so the delay
   * between saga steps does not depend on the polling interval.
   */
  wake(): void {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.schedule(0);
  }

  private schedule(delayMs: number) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  private async tick() {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;

    try {
      // A full batch means there is probably more: keep draining without a pause.
      while (!this.stopped && (await this.drainBatch()) === this.batchSize) {
        /* keep going */
      }
    } catch (e) {
      this.logger.error(`relay error: ${String(e)}`);
    } finally {
      this.running = false;
      this.schedule(this.rerun ? 0 : this.pollIntervalMs);
      this.rerun = false;
    }
  }

  /** Returns the number of messages sent successfully. */
  private async drainBatch(): Promise<number> {
    // A lease instead of a long transaction: the row is "booked" for leaseMs,
    // and the network call to RabbitMQ happens without an open Postgres transaction.
    const claimed = await this.db.$queryRaw<ClaimedMessage[]>`
      UPDATE outbox_messages
      SET locked_until = now() + ${this.leaseMs}::int * interval '1 millisecond',
          attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM outbox_messages
        WHERE published_at IS NULL
          AND (locked_until IS NULL OR locked_until < now())
        ORDER BY created_at
        LIMIT ${this.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, routing_key AS "routingKey", payload, created_at AS "createdAt", attempts
    `;
    if (claimed.length === 0) return 0;

    // RETURNING does not guarantee order — restore the write order.
    claimed.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    const published: string[] = [];
    let failure: { error: string; rest: ClaimedMessage[] } | undefined;

    for (const [index, message] of claimed.entries()) {
      try {
        await this.publisher.publish(
          message.routingKey,
          message.payload,
          message.id,
        );
        published.push(message.id);
      } catch (e) {
        // Stop at the first error so that later messages are never sent
        // before earlier ones.
        failure = { error: String(e), rest: claimed.slice(index) };
        break;
      }
    }

    if (published.length > 0) {
      await this.db.$executeRaw`
        UPDATE outbox_messages
        SET published_at = now(), locked_until = NULL, last_error = NULL
        WHERE id = ANY(${published}::uuid[])
      `;
    }

    if (failure) {
      const ids = failure.rest.map((m) => m.id);
      const attempts = failure.rest[0].attempts;
      // Exponential backoff before the retry, capped at one minute.
      const backoffMs = Math.min(1000 * 2 ** Math.min(attempts, 6), 60_000);
      await this.db.$executeRaw`
        UPDATE outbox_messages
        SET last_error = ${failure.error},
            locked_until = now() + ${backoffMs}::int * interval '1 millisecond'
        WHERE id = ANY(${ids}::uuid[])
      `;
      this.logger.warn(
        `failed to send ${ids.length} message(s) (attempt ${attempts}), retrying in ${backoffMs} ms: ${failure.error}`,
      );
      return 0;
    }

    return published.length;
  }

  /** Sent messages and inbox records past the retention period are no longer needed. */
  private async cleanup() {
    try {
      const outbox = await this.db.$executeRaw`
        DELETE FROM outbox_messages
        WHERE published_at < now() - ${this.retentionDays}::int * interval '1 day'
      `;
      const inbox = await this.db.$executeRaw`
        DELETE FROM inbox_messages
        WHERE processed_at < now() - ${this.retentionDays}::int * interval '1 day'
      `;
      if (outbox + inbox > 0) {
        this.logger.log(`cleanup: outbox −${outbox}, inbox −${inbox}`);
      }
    } catch (e) {
      this.logger.error(`cleanup error: ${String(e)}`);
    }
  }
}
