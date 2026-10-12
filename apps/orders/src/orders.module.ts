import { Module } from '@nestjs/common';
import { AppConfigModule } from '@app/common';
import { OutboxModule } from '@app/outbox';
import { OrdersController } from './orders.controller';
import { PrismaService } from './prisma.service';
import { SagaTimeoutWatcher } from './saga-timeout.watcher';
import { SagaOrchestrator } from './saga.orchestrator';
import { SagaRepository } from './saga.repository';
import { SagasController } from './sagas.controller';

@Module({
  imports: [AppConfigModule, OutboxModule.forRoot({ database: PrismaService })],
  controllers: [OrdersController, SagasController],
  providers: [SagaRepository, SagaOrchestrator, SagaTimeoutWatcher],
})
export class OrdersModule {}
