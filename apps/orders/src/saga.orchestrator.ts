import { Injectable, Logger } from '@nestjs/common';
import { OutboxWriter } from '@app/outbox';
import { Routing, SagaStatus, SagaStep } from '@app/contracts';
import type {
  AssignCourierCommand,
  ChargePaymentCommand,
  CourierAssignedEvent,
  CourierUnassignedEvent,
  CourierUnavailableEvent,
  CreateOrderCommand,
  OrderCancelledEvent,
  OrderConfirmedEvent,
  PaymentChargedEvent,
  PaymentFailedEvent,
  PaymentRefundedEvent,
  RefundPaymentCommand,
  ReleaseStockCommand,
  ReserveStockCommand,
  StockRejectedEvent,
  StockReleasedEvent,
  StockReservedEvent,
  UnassignCourierCommand,
} from '@app/contracts';
import { SagaRepository } from './saga.repository';
import type { SagaEntity, Tx } from './saga.repository';

/** How long to wait for a participant's reply before the step counts as failed. */
export const STEP_TIMEOUT_MS = Number(
  process.env.SAGA_STEP_TIMEOUT_MS ?? 30_000,
);

/**
 * Orchestrator of the "place order" saga.
 *
 * Forward:   STOCK → PAYMENT → COURIER → order.confirmed
 * Rollback:  unwind the `completed` stack from the top, one compensation at a
 *            time, waiting for each to be confirmed → order.cancelled
 *
 * Every method runs inside a single orders_db transaction: the saga state change,
 * the history entry and the outgoing command in the outbox commit atomically.
 * So "the step is recorded but the command was never sent" (or vice versa)
 * cannot happen — that is the transactional outbox.
 *
 * The orchestrator holds none of the participants' business logic: it only
 * decides which command to send next based on the current saga state.
 */
@Injectable()
export class SagaOrchestrator {
  private readonly logger = new Logger(SagaOrchestrator.name);

  constructor(
    private readonly sagas: SagaRepository,
    private readonly outbox: OutboxWriter,
  ) {}

  // ───────────────────────────── forward path ─────────────────────────────

  async start(tx: Tx, cmd: CreateOrderCommand): Promise<void> {
    if (await this.sagas.exists(tx, cmd.sagaId)) {
      this.logger.warn(
        `saga ${cmd.sagaId} already started — duplicate skipped`,
      );
      return;
    }

    const amountCents = cmd.items.reduce(
      (sum, item) => sum + item.priceCents * item.qty,
      0,
    );

    const saga: SagaEntity = {
      sagaId: cmd.sagaId,
      orderId: cmd.orderId,
      customerId: cmd.customerId,
      address: cmd.address,
      items: cmd.items,
      amountCents,
      status: SagaStatus.StockPending,
      completed: [],
      awaiting: SagaStep.Stock,
      deadlineAt: null,
    };
    this.arm(saga);

    await this.sagas.create(tx, saga);
    await this.note(tx, saga, `saga started, order total ${amountCents} cents`);
    this.logger.log(`[${saga.sagaId}] start → reserving stock`);

    const command: ReserveStockCommand = {
      sagaId: saga.sagaId,
      orderId: saga.orderId,
      items: saga.items,
      idempotencyKey: `${saga.sagaId}:reserve`,
    };
    await this.outbox.add(tx, Routing.ReserveStock, command);
  }

  async onStockReserved(tx: Tx, event: StockReservedEvent): Promise<void> {
    const saga = await this.expect(tx, event.sagaId, SagaStatus.StockPending, {
      step: SagaStep.Stock,
      resourceId: event.reservationId,
    });
    if (!saga) return;

    saga.reservationId = event.reservationId;
    saga.completed.push(SagaStep.Stock);
    await this.note(tx, saga, `stock reserved (${event.reservationId})`);
    this.logger.log(`[${saga.sagaId}] reservation ok → charging payment`);

    saga.status = SagaStatus.PaymentPending;
    saga.awaiting = SagaStep.Payment;
    this.arm(saga);

    const command: ChargePaymentCommand = {
      sagaId: saga.sagaId,
      orderId: saga.orderId,
      customerId: saga.customerId,
      amountCents: saga.amountCents,
      idempotencyKey: `${saga.sagaId}:charge`,
    };
    await this.outbox.add(tx, Routing.ChargePayment, command);
    await this.sagas.save(tx, saga);
  }

  async onStockRejected(tx: Tx, event: StockRejectedEvent): Promise<void> {
    const saga = await this.expect(tx, event.sagaId, SagaStatus.StockPending);
    if (!saga) return;

    await this.note(tx, saga, `reservation rejected: ${event.reason}`);
    this.logger.warn(`[${saga.sagaId}] reservation rejected: ${event.reason}`);

    // completed is empty — nothing to compensate, the saga closes as cancelled at once.
    await this.beginCompensation(tx, saga, event.reason);
  }

  async onPaymentCharged(tx: Tx, event: PaymentChargedEvent): Promise<void> {
    const saga = await this.expect(
      tx,
      event.sagaId,
      SagaStatus.PaymentPending,
      {
        step: SagaStep.Payment,
        resourceId: event.paymentId,
      },
    );
    if (!saga) return;

    saga.paymentId = event.paymentId;
    saga.completed.push(SagaStep.Payment);
    await this.note(tx, saga, `payment charged (${event.paymentId})`);
    this.logger.log(`[${saga.sagaId}] payment ok → finding a courier`);

    saga.status = SagaStatus.CourierPending;
    saga.awaiting = SagaStep.Courier;
    this.arm(saga);

    const command: AssignCourierCommand = {
      sagaId: saga.sagaId,
      orderId: saga.orderId,
      address: saga.address,
      idempotencyKey: `${saga.sagaId}:assign`,
    };
    await this.outbox.add(tx, Routing.AssignCourier, command);
    await this.sagas.save(tx, saga);
  }

  async onPaymentFailed(tx: Tx, event: PaymentFailedEvent): Promise<void> {
    const saga = await this.expect(tx, event.sagaId, SagaStatus.PaymentPending);
    if (!saga) return;

    await this.note(tx, saga, `payment failed: ${event.reason}`);
    this.logger.warn(`[${saga.sagaId}] payment failed: ${event.reason}`);

    await this.beginCompensation(tx, saga, event.reason);
  }

  async onCourierAssigned(tx: Tx, event: CourierAssignedEvent): Promise<void> {
    const saga = await this.expect(
      tx,
      event.sagaId,
      SagaStatus.CourierPending,
      {
        step: SagaStep.Courier,
        resourceId: event.courierId,
      },
    );
    if (!saga) return;

    saga.courierId = event.courierId;
    saga.completed.push(SagaStep.Courier);
    saga.awaiting = undefined;
    saga.status = SagaStatus.Confirmed;
    this.disarm(saga);
    await this.note(
      tx,
      saga,
      `courier assigned (${event.courierId}) — order confirmed`,
    );
    this.logger.log(`[${saga.sagaId}] ✓ order confirmed`);

    const confirmed: OrderConfirmedEvent = {
      sagaId: saga.sagaId,
      orderId: saga.orderId,
      customerId: saga.customerId,
      courierId: event.courierId,
      amountCents: saga.amountCents,
    };
    await this.outbox.add(tx, Routing.OrderConfirmed, confirmed);
    await this.sagas.save(tx, saga);
  }

  async onCourierUnavailable(
    tx: Tx,
    event: CourierUnavailableEvent,
  ): Promise<void> {
    const saga = await this.expect(tx, event.sagaId, SagaStatus.CourierPending);
    if (!saga) return;

    await this.note(tx, saga, `courier not found: ${event.reason}`);
    this.logger.warn(`[${saga.sagaId}] courier not found: ${event.reason}`);

    await this.beginCompensation(tx, saga, event.reason);
  }

  // ───────────────────────────── compensations ─────────────────────────────

  async onStockReleased(tx: Tx, event: StockReleasedEvent): Promise<void> {
    await this.onCompensated(
      tx,
      event.sagaId,
      SagaStep.Stock,
      event.reservationId,
      `stock released (${event.reservationId})`,
    );
  }

  async onPaymentRefunded(tx: Tx, event: PaymentRefundedEvent): Promise<void> {
    await this.onCompensated(
      tx,
      event.sagaId,
      SagaStep.Payment,
      event.paymentId,
      `payment refunded (${event.paymentId})`,
    );
  }

  async onCourierUnassigned(
    tx: Tx,
    event: CourierUnassignedEvent,
  ): Promise<void> {
    await this.onCompensated(
      tx,
      event.sagaId,
      SagaStep.Courier,
      event.courierId,
      `courier released (${event.courierId})`,
    );
  }

  private async beginCompensation(
    tx: Tx,
    saga: SagaEntity,
    reason: string,
  ): Promise<void> {
    saga.failureReason = reason;
    saga.status = SagaStatus.Compensating;
    await this.note(tx, saga, `rollback started: ${reason}`);
    await this.compensateNext(tx, saga);
  }

  /**
   * Pops one step off the top of the `completed` stack and sends its compensation.
   * Once the stack is empty, the saga closes as cancelled.
   */
  private async compensateNext(tx: Tx, saga: SagaEntity): Promise<void> {
    const step = saga.completed.pop();

    if (!step) {
      saga.awaiting = undefined;
      saga.status = SagaStatus.Cancelled;
      this.disarm(saga);
      await this.note(tx, saga, 'all compensations done — order cancelled');
      this.logger.log(`[${saga.sagaId}] ✗ order cancelled`);

      const cancelled: OrderCancelledEvent = {
        sagaId: saga.sagaId,
        orderId: saga.orderId,
        customerId: saga.customerId,
        reason: saga.failureReason ?? 'UNKNOWN',
      };
      await this.outbox.add(tx, Routing.OrderCancelled, cancelled);
      await this.sagas.save(tx, saga);
      return;
    }

    saga.awaiting = step;
    this.logger.log(`[${saga.sagaId}] rolling back step ${step}`);

    switch (step) {
      case SagaStep.Courier: {
        if (!saga.courierId) {
          throw new Error(`saga ${saga.sagaId}: no courierId to roll back`);
        }
        const command: UnassignCourierCommand = {
          sagaId: saga.sagaId,
          orderId: saga.orderId,
          courierId: saga.courierId,
          idempotencyKey: `${saga.sagaId}:unassign`,
        };
        await this.note(tx, saga, 'rollback: releasing courier');
        await this.outbox.add(tx, Routing.UnassignCourier, command);
        break;
      }

      case SagaStep.Payment: {
        if (!saga.paymentId) {
          throw new Error(`saga ${saga.sagaId}: no paymentId to roll back`);
        }
        const command: RefundPaymentCommand = {
          sagaId: saga.sagaId,
          orderId: saga.orderId,
          paymentId: saga.paymentId,
          idempotencyKey: `${saga.sagaId}:refund`,
        };
        await this.note(tx, saga, 'rollback: refunding payment');
        await this.outbox.add(tx, Routing.RefundPayment, command);
        break;
      }

      case SagaStep.Stock: {
        if (!saga.reservationId) {
          throw new Error(`saga ${saga.sagaId}: no reservationId to roll back`);
        }
        const command: ReleaseStockCommand = {
          sagaId: saga.sagaId,
          orderId: saga.orderId,
          reservationId: saga.reservationId,
          idempotencyKey: `${saga.sagaId}:release`,
        };
        await this.note(tx, saga, 'rollback: releasing stock reservation');
        await this.outbox.add(tx, Routing.ReleaseStock, command);
        break;
      }
    }

    this.arm(saga);
    await this.sagas.save(tx, saga);
  }

  private async onCompensated(
    tx: Tx,
    sagaId: string,
    step: SagaStep,
    resourceId: string,
    note: string,
  ): Promise<void> {
    const saga = await this.sagas.lock(tx, sagaId);

    // Check the resource too: confirming the rollback of a "late" step (see
    // undoLateSuccess) must not count as rolling back the step the saga awaits.
    if (
      !saga ||
      saga.status !== SagaStatus.Compensating ||
      saga.awaiting !== step ||
      this.resourceOf(saga, step) !== resourceId
    ) {
      this.logger.warn(
        `[${sagaId}] duplicate/late reply to rollback of ${step} — skipped`,
      );
      return;
    }

    await this.note(tx, saga, `rollback: ${note}`);
    await this.compensateNext(tx, saga);
  }

  // ───────────────────────────── timeouts ─────────────────────────────

  /**
   * The timer is the deadline_at column, not setTimeout: it survives a service
   * restart and works across several instances (see SagaTimeoutWatcher).
   */
  private arm(saga: SagaEntity): void {
    saga.deadlineAt = new Date(Date.now() + STEP_TIMEOUT_MS);
  }

  private disarm(saga: SagaEntity): void {
    saga.deadlineAt = null;
  }

  async onTimeout(tx: Tx, sagaId: string): Promise<void> {
    const saga = await this.sagas.lock(tx, sagaId);

    // While we waited for the lock, a reply may have arrived and cleared or re-armed the timer.
    if (!saga || !saga.deadlineAt || saga.deadlineAt > new Date()) return;

    if (saga.status === SagaStatus.Compensating) {
      // The rollback itself did not get through. Nothing more can be done
      // automatically — it needs a retry or manual review, so mark the saga as stuck.
      saga.status = SagaStatus.Stuck;
      this.disarm(saga);
      await this.note(
        tx,
        saga,
        `rollback of step ${saga.awaiting ?? '?'} timed out — manual review required`,
      );
      this.logger.error(
        `[${sagaId}] stuck rolling back ${saga.awaiting ?? '?'}`,
      );
      await this.sagas.save(tx, saga);
      return;
    }

    await this.note(
      tx,
      saga,
      `timed out waiting for step ${saga.awaiting ?? '?'}`,
    );
    this.logger.warn(
      `[${sagaId}] step ${saga.awaiting ?? '?'} timed out — rolling back`,
    );
    await this.beginCompensation(tx, saga, 'TIMEOUT');
  }

  // ───────────────────────────── late replies ─────────────────────────────

  /**
   * A participant completed the step, but the reply arrived when the saga was
   * already rolling back or cancelled — usually after a timeout. The saga does not
   * know about this resource and would never compensate it: without this branch the
   * stock would stay reserved, the money charged, the courier busy. We send a
   * compensation for this step only; the saga state does not change.
   */
  private async undoLateSuccess(
    tx: Tx,
    saga: SagaEntity,
    step: SagaStep,
    resourceId: string,
  ): Promise<void> {
    await this.note(
      tx,
      saga,
      `late reply for step ${step} (${resourceId}) while ${saga.status} — undoing it`,
    );
    this.logger.warn(
      `[${saga.sagaId}] late reply for step ${step} — sending a compensation`,
    );

    switch (step) {
      case SagaStep.Stock: {
        const command: ReleaseStockCommand = {
          sagaId: saga.sagaId,
          orderId: saga.orderId,
          reservationId: resourceId,
          idempotencyKey: `${saga.sagaId}:release-late`,
        };
        await this.outbox.add(tx, Routing.ReleaseStock, command);
        break;
      }
      case SagaStep.Payment: {
        const command: RefundPaymentCommand = {
          sagaId: saga.sagaId,
          orderId: saga.orderId,
          paymentId: resourceId,
          idempotencyKey: `${saga.sagaId}:refund-late`,
        };
        await this.outbox.add(tx, Routing.RefundPayment, command);
        break;
      }
      case SagaStep.Courier: {
        const command: UnassignCourierCommand = {
          sagaId: saga.sagaId,
          orderId: saga.orderId,
          courierId: resourceId,
          idempotencyKey: `${saga.sagaId}:unassign-late`,
        };
        await this.outbox.add(tx, Routing.UnassignCourier, command);
        break;
      }
    }
  }

  private resourceOf(saga: SagaEntity, step: SagaStep): string | undefined {
    switch (step) {
      case SagaStep.Stock:
        return saga.reservationId;
      case SagaStep.Payment:
        return saga.paymentId;
      case SagaStep.Courier:
        return saga.courierId;
    }
  }

  // ───────────────────────────── misc ─────────────────────────────

  private async note(tx: Tx, saga: SagaEntity, note: string): Promise<void> {
    await this.sagas.note(tx, saga.sagaId, note);
  }

  /**
   * Returns the saga (locked until the end of the transaction) only if it is
   * in the expected status.
   *
   * Success replies pass `success`: if the saga has already moved on and this
   * resource is not recorded in it, the reply is late (usually it arrived after
   * the step timed out). Such a reply is not just skipped but rolled back.
   */
  private async expect(
    tx: Tx,
    sagaId: string,
    status: SagaStatus,
    success?: { step: SagaStep; resourceId: string },
  ): Promise<SagaEntity | undefined> {
    const saga = await this.sagas.lock(tx, sagaId);

    if (!saga) {
      this.logger.warn(`[${sagaId}] saga not found — reply skipped`);
      return undefined;
    }

    if (saga.status !== status) {
      if (
        success &&
        this.resourceOf(saga, success.step) !== success.resourceId
      ) {
        await this.undoLateSuccess(tx, saga, success.step, success.resourceId);
        return undefined;
      }
      this.logger.warn(
        `[${sagaId}] status ${saga.status}, expected ${status} — reply skipped`,
      );
      return undefined;
    }

    return saga;
  }
}
