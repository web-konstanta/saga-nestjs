import { Module } from '@nestjs/common';
import { AppConfigModule } from '@app/common';
import { OutboxModule } from '@app/outbox';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { PrismaService } from './prisma.service';

@Module({
  imports: [AppConfigModule, OutboxModule.forRoot({ database: PrismaService })],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
