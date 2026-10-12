import { Module } from '@nestjs/common';
import { AppConfigModule } from '@app/common';
import { OutboxModule } from '@app/outbox';
import { CouriersController } from './couriers.controller';
import { CouriersService } from './couriers.service';
import { PrismaService } from './prisma.service';

@Module({
  imports: [AppConfigModule, OutboxModule.forRoot({ database: PrismaService })],
  controllers: [CouriersController],
  providers: [CouriersService],
})
export class CouriersModule {}
