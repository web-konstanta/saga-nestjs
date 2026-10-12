import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { PaymentsModule } from './payments.module';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    PaymentsModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL!],
        queue: 'q.payments',
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
