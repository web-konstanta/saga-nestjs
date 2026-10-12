import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { InboxProcessor, OutboxWriter } from '@app/outbox';
import { Routing } from '@app/contracts';
import type {
  ChargePaymentCommand,
  PaymentChargedEvent,
  PaymentFailedEvent,
  PaymentRefundedEvent,
  RefundPaymentCommand,
} from '@app/contracts';
import { PaymentsService } from './payments.service';
import type { Tx } from './prisma.service';

@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly inbox: InboxProcessor,
    private readonly outbox: OutboxWriter,
  ) {}

  /** Forward saga step: charge the customer. */
  @EventPattern<string>(Routing.ChargePayment)
  async charge(@Payload() data: ChargePaymentCommand, @Ctx() ctx: RmqContext) {
    await this.inbox.handle<Tx>(ctx, Routing.ChargePayment, async (tx) => {
      const result = await this.payments.charge(tx, data);

      if (result.ok) {
        const event: PaymentChargedEvent = {
          sagaId: data.sagaId,
          orderId: data.orderId,
          paymentId: result.paymentId,
        };
        await this.outbox.add(tx, Routing.PaymentCharged, event);
        return;
      }

      const event: PaymentFailedEvent = {
        sagaId: data.sagaId,
        orderId: data.orderId,
        reason: result.reason,
      };
      await this.outbox.add(tx, Routing.PaymentFailed, event);
    });
  }

  /** Compensation: refund the customer. */
  @EventPattern<string>(Routing.RefundPayment)
  async refund(@Payload() data: RefundPaymentCommand, @Ctx() ctx: RmqContext) {
    await this.inbox.handle<Tx>(ctx, Routing.RefundPayment, async (tx) => {
      await this.payments.refund(tx, data);

      const event: PaymentRefundedEvent = {
        sagaId: data.sagaId,
        orderId: data.orderId,
        paymentId: data.paymentId,
      };
      await this.outbox.add(tx, Routing.PaymentRefunded, event);
    });
  }
}
