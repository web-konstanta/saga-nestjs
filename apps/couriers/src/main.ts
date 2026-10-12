import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { CouriersModule } from './couriers.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    CouriersModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL!],
        queue: 'q.couriers',
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
