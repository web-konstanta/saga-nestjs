import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { OrdersModule } from './orders.module';

/**
 * A hybrid app: an HTTP server (only for viewing saga state) plus an RMQ
 * consumer of the q.orders queue, through which the whole saga flows.
 */
async function bootstrap() {
  const app = await NestFactory.create(OrdersModule);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL!],
      queue: 'q.orders',
      noAck: false,
      prefetchCount: 1,
      // The queue is already created by the topology script with deadLetterExchange.
      // Without noAssert Nest would redeclare it without that argument → 406.
      noAssert: true,
    },
  });

  // SIGTERM/SIGINT → onModuleDestroy: the relay and the timeout watcher stop,
  // and the database and broker connections are closed gracefully.
  app.enableShutdownHooks();

  await app.startAllMicroservices();
  await app.listen(process.env.ORDERS_PORT ?? 3001);
}
void bootstrap();
