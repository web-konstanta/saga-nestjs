import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { NotificationsModule } from './notifications.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    NotificationsModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL!],
        queue: 'q.notifications',
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
