import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { InboxProcessor } from '@app/outbox';
import { Routing } from '@app/contracts';
import type { OrderCancelledEvent, OrderConfirmedEvent } from '@app/contracts';
import { NotificationsService } from './notifications.service';
import type { Tx } from './prisma.service';

@Controller()
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly inbox: InboxProcessor,
  ) {}

  @EventPattern<string>(Routing.OrderConfirmed)
  async confirmed(
    @Payload() data: OrderConfirmedEvent,
    @Ctx() ctx: RmqContext,
  ) {
    await this.inbox.handle<Tx>(ctx, Routing.OrderConfirmed, (tx) =>
      this.notifications.orderConfirmed(tx, data),
    );
  }

  @EventPattern<string>(Routing.OrderCancelled)
  async cancelled(
    @Payload() data: OrderCancelledEvent,
    @Ctx() ctx: RmqContext,
  ) {
    await this.inbox.handle<Tx>(ctx, Routing.OrderCancelled, (tx) =>
      this.notifications.orderCancelled(tx, data),
    );
  }
}
