import { Module } from '@nestjs/common';
import { AppConfigModule } from '@app/common';
import { MessagingModule } from '@app/messaging';
import { GatewayController } from './gateway.controller';
import { OrdersClient } from './orders.client';
import { SagasController } from './sagas.controller';

// AppConfigModule is required: RabbitPublisher reads RABBITMQ_URL through
// ConfigService, and without it the controller's DI cannot be resolved.
@Module({
  imports: [AppConfigModule, MessagingModule],
  controllers: [GatewayController, SagasController],
  providers: [OrdersClient],
})
export class GatewayModule {}
