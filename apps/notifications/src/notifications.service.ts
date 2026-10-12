import { Injectable, Logger } from '@nestjs/common';
import type { OrderCancelledEvent, OrderConfirmedEvent } from '@app/contracts';
import type { Tx } from './prisma.service';

/**
 * The final consumer of domain events. It publishes nothing back and has no
 * effect on the saga — so failing here is safe for the order.
 *
 * The notification is stored in the same transaction as the inbox record: a
 * redelivered event will not send the customer a second message.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  async orderConfirmed(tx: Tx, event: OrderConfirmedEvent): Promise<void> {
    const message =
      `order ${event.orderId} confirmed, ` +
      `courier ${event.courierId}, total ${event.amountCents} cents`;

    await tx.notification.create({
      data: {
        orderId: event.orderId,
        customerId: event.customerId,
        kind: 'ORDER_CONFIRMED',
        message,
      },
    });
    this.logger.log(`✉ to customer ${event.customerId}: ${message}`);
  }

  async orderCancelled(tx: Tx, event: OrderCancelledEvent): Promise<void> {
    const message = `order ${event.orderId} cancelled (${event.reason})`;

    await tx.notification.create({
      data: {
        orderId: event.orderId,
        customerId: event.customerId,
        kind: 'ORDER_CANCELLED',
        message,
      },
    });
    this.logger.log(`✉ to customer ${event.customerId}: ${message}`);
  }
}
