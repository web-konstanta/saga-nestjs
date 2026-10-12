import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { InventoryModule } from './inventory.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    InventoryModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL!],
        queue: 'q.inventory',
        noAck: false,
        prefetchCount: 1,
        noAssert: true,
      },
    },
  );
  // SIGTERM/SIGINT → onModuleDestroy: the relay stops and the database and
  // broker connections are closed gracefully.
  app.enableShutdownHooks();
  await app.listen();
}
void bootstrap();
