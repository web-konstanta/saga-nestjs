import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { GatewayModule } from './gateway.module';

async function bootstrap() {
  const app = await NestFactory.create(GatewayModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // The storefront calls the gateway directly from the browser (no dev proxy).
  // 5173 is `vite`, 4173 is `vite preview`.
  app.enableCors({
    origin: (
      process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:4173'
    ).split(','),
  });

  // SIGTERM/SIGINT → onModuleDestroy: the relay stops and the database and
  // broker connections are closed gracefully.
  app.enableShutdownHooks();
  await app.listen(process.env.GATEWAY_PORT ?? 3000);
}
void bootstrap();
