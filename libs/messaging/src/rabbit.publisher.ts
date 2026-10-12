import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as amqp from 'amqplib';
import { DLX, EXCHANGE } from '@app/contracts';

@Injectable()
export class RabbitPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitPublisher.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.ConfirmChannel;
  private connecting?: Promise<amqp.ConfirmChannel>;
  private closing = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    // Connect for the first time at startup: without a broker the service
    // must not pretend to be ready.
    await this.getChannel();
  }

  async onModuleDestroy() {
    this.closing = true;
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  /**
   * The channel is reopened lazily: if the broker restarted, the next publish
   * reconnects. For the outbox relay this is the recovery — unsent messages
   * simply stay in the database until an attempt succeeds.
   */
  private getChannel(): Promise<amqp.ConfirmChannel> {
    if (this.channel) return Promise.resolve(this.channel);

    this.connecting ??= this.connect().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async connect(): Promise<amqp.ConfirmChannel> {
    const connection = await amqp.connect(
      this.config.getOrThrow('RABBITMQ_URL'),
    );
    connection.on('error', (e: Error) =>
      this.logger.warn(`connection: ${e.message}`),
    );
    connection.on('close', () => {
      this.connection = undefined;
      this.channel = undefined;
      if (!this.closing) {
        this.logger.warn(
          'lost the broker connection — will reconnect on the next publish',
        );
      }
    });

    const channel = await connection.createConfirmChannel();
    channel.on('error', (e: Error) =>
      this.logger.warn(`channel: ${e.message}`),
    );
    channel.on('close', () => {
      this.channel = undefined;
    });

    // Idempotent: if the topology script already created the exchange with the
    // same parameters, this is a no-op. Without it, publishing to a missing exchange
    // closes the channel with 404 NOT_FOUND and breaks every later send.
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    await channel.assertExchange(DLX, 'topic', { durable: true });

    this.connection = connection;
    this.channel = channel;
    this.logger.log('publisher connected');
    return channel;
  }

  /**
   * @param messageId a stable message id. For the outbox it is the row id: a resend
   *                  carries the same id, so the receiver drops the duplicate.
   */
  async publish(
    routingKey: string,
    data: unknown,
    messageId: string = randomUUID(),
  ) {
    const channel = await this.getChannel();

    // pattern in the body is what NestJS uses to pick the handler method.
    // routingKey on the envelope is what RabbitMQ uses to pick the queue.
    const body = Buffer.from(JSON.stringify({ pattern: routingKey, data }));

    await new Promise<void>((resolve, reject) => {
      channel.publish(
        EXCHANGE,
        routingKey,
        body,
        {
          persistent: true,
          contentType: 'application/json',
          messageId,
          type: routingKey,
          timestamp: Math.floor(Date.now() / 1000),
        },
        (err: Error | null) => (err ? reject(err) : resolve()),
      );
    });

    this.logger.debug(`→ ${routingKey} (${messageId})`);
  }
}
