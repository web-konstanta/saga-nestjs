import { Module } from '@nestjs/common';
import { AppConfigModule } from '@app/common';
import { OutboxModule } from '@app/outbox';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PrismaService } from './prisma.service';

// Notifications publishes nothing, but the inbox and relay come with
// OutboxModule: every service is built the same way, and once an outgoing
// event appears it can be written right away.
@Module({
  imports: [AppConfigModule, OutboxModule.forRoot({ database: PrismaService })],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
