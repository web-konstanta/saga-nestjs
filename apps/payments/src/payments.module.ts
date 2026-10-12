import { Module } from '@nestjs/common';
import { AppConfigModule } from '@app/common';
import { OutboxModule } from '@app/outbox';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PrismaService } from './prisma.service';

@Module({
  imports: [AppConfigModule, OutboxModule.forRoot({ database: PrismaService })],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
