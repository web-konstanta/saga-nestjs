import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { InboxProcessor } from '@app/outbox';
import { Routing } from '@app/contracts';
import type {
  CourierAssignedEvent,
  CourierUnassignedEvent,
  CourierUnavailableEvent,
  CreateOrderCommand,
  PaymentChargedEvent,
  PaymentFailedEvent,
  PaymentRefundedEvent,
  StockRejectedEvent,
  StockReleasedEvent,
  StockReservedEvent,
} from '@app/contracts';
import { SagaOrchestrator } from './saga.orchestrator';
import type { Tx } from './saga.repository';

/**
 * The single entry point for messages into the orchestrator. It reads q.orders;
 * each @EventPattern is a key in Nest's handler Map, not a broker subscription:
 * which messages arrive here is decided by the 'orders.*' binding in the topology.
 *
 * Each message is handled in an InboxProcessor transaction: duplicates are dropped
 * by messageId, saga changes and outgoing commands commit together, ack comes after.
 */
@Controller()
export class OrdersController {
  constructor(
    private readonly saga: SagaOrchestrator,
    private readonly inbox: InboxProcessor,
  ) {}

  @EventPattern<string>(Routing.CreateOrder)
  async create(@Payload() data: CreateOrderCommand, @Ctx() ctx: RmqContext) {
    await this.inbox.handle<Tx>(ctx, Routing.CreateOrder, (tx) =>
      this.saga.start(tx, data),
    );
  }

  // ── replies to forward steps ──

  @EventPattern<string>(Routing.StockReserved)
  async stockReserved(
    @Payload() data: StockReservedEvent,
    @Ctx() ctx: RmqContext,
  ) {
    await this.inbox.handle<Tx>(ctx, Routing.StockReserved, (tx) =>
      this.saga.onStockReserved(tx, data),
    );
  }

  @EventPattern<string>(Routing.StockRejected)
  async stockRejected(
    @Payload() data: StockRejectedEvent,
    @Ctx() ctx: RmqContext,
  ) {
    await this.inbox.handle<Tx>(ctx, Routing.StockRejected, (tx) =>
      this.saga.onStockRejected(tx, data),
    );
  }

  @EventPattern<string>(Routing.PaymentCharged)
  async paymentCharged(
    @Payload() data: PaymentChargedEvent,
    @Ctx() ctx: RmqContext,
  ) {
    await this.inbox.handle<Tx>(ctx, Routing.PaymentCharged, (tx) =>
      this.saga.onPaymentCharged(tx, data),
    );
  }

  @EventPattern<string>(Routing.PaymentFailed)
  async paymentFailed(
    @Payload() data: PaymentFailedEvent,
    @Ctx() ctx: RmqContext,
  ) {
    await this.inbox.handle<Tx>(ctx, Routing.PaymentFailed, (tx) =>
      this.saga.onPaymentFailed(tx, data),
    );
  }

  @EventPattern<string>(Routing.CourierAssigned)
  async courierAssigned(
    @Payload() data: CourierAssignedEvent,
    @Ctx() ctx: RmqContext,
  ) {
    await this.inbox.handle<Tx>(ctx, Routing.CourierAssigned, (tx) =>
      this.saga.onCourierAssigned(tx, data),
    );
  }

  @EventPattern<string>(Routing.CourierUnavailable)
  async courierUnavailable(
    @Payload() data: CourierUnavailableEvent,
    @Ctx() ctx: RmqContext,
  ) {
    await this.inbox.handle<Tx>(ctx, Routing.CourierUnavailable, (tx) =>
      this.saga.onCourierUnavailable(tx, data),
    );
  }

  // ── compensation confirmations ──

  @EventPattern<string>(Routing.StockReleased)
  async stockReleased(
    @Payload() data: StockReleasedEvent,
    @Ctx() ctx: RmqContext,
  ) {
    await this.inbox.handle<Tx>(ctx, Routing.StockReleased, (tx) =>
      this.saga.onStockReleased(tx, data),
    );
  }

  @EventPattern<string>(Routing.PaymentRefunded)
  async paymentRefunded(
    @Payload() data: PaymentRefundedEvent,
    @Ctx() ctx: RmqContext,
  ) {
    await this.inbox.handle<Tx>(ctx, Routing.PaymentRefunded, (tx) =>
      this.saga.onPaymentRefunded(tx, data),
    );
  }

  @EventPattern<string>(Routing.CourierUnassigned)
  async courierUnassigned(
    @Payload() data: CourierUnassignedEvent,
    @Ctx() ctx: RmqContext,
  ) {
    await this.inbox.handle<Tx>(ctx, Routing.CourierUnassigned, (tx) =>
      this.saga.onCourierUnassigned(tx, data),
    );
  }
}
