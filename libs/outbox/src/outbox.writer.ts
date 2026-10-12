import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { SqlExecutor } from './database';

/**
 * Writes an outgoing message. Call it ONLY inside the transaction that changes the
 * business data: either both the data and the message commit, or neither does.
 * OutboxRelay sends the message to RabbitMQ later.
 */
@Injectable()
export class OutboxWriter {
  async add(
    tx: SqlExecutor,
    routingKey: string,
    payload: unknown,
  ): Promise<string> {
    const id = randomUUID();

    // clock_timestamp(), not now(): now() is fixed at transaction start, so several
    // messages from one transaction would get the same timestamp.
    await tx.$executeRaw`
      INSERT INTO outbox_messages (id, routing_key, payload, created_at)
      VALUES (${id}::uuid, ${routingKey}, ${JSON.stringify(payload)}::jsonb, clock_timestamp())
    `;

    return id;
  }
}
