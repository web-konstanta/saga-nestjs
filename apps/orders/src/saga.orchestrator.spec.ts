import { Test, TestingModule } from '@nestjs/testing';
import { OutboxWriter } from '@app/outbox';
import { Routing, SagaStatus } from '@app/contracts';
import type { CreateOrderCommand } from '@app/contracts';
import { SagaOrchestrator } from './saga.orchestrator';
import { SagaRepository } from './saga.repository';
import type { SagaEntity, Tx } from './saga.repository';

const SAGA_ID = 'saga-1';
const ORDER_ID = 'order-1';

const createOrder: CreateOrderCommand = {
  sagaId: SAGA_ID,
  orderId: ORDER_ID,
  customerId: 'c-1',
  address: '1 Club St',
  items: [{ sku: 'ABC-1', qty: 2, priceCents: 500 }],
};

/** In-memory repository: the orchestrator is tested without a database. */
class InMemorySagaRepository {
  readonly sagas = new Map<string, SagaEntity>();
  readonly notes: string[] = [];

  exists(_tx: Tx, sagaId: string) {
    return Promise.resolve(this.sagas.has(sagaId));
  }
  create(_tx: Tx, saga: SagaEntity) {
    this.sagas.set(saga.sagaId, structuredClone(saga));
    return Promise.resolve();
  }
  lock(_tx: Tx, sagaId: string) {
    const saga = this.sagas.get(sagaId);
    return Promise.resolve(saga ? structuredClone(saga) : undefined);
  }
  save(_tx: Tx, saga: SagaEntity) {
    this.sagas.set(saga.sagaId, structuredClone(saga));
    return Promise.resolve();
  }
  note(_tx: Tx, _sagaId: string, note: string) {
    this.notes.push(note);
    return Promise.resolve();
  }
}

describe('SagaOrchestrator', () => {
  let orchestrator: SagaOrchestrator;
  let repo: InMemorySagaRepository;
  let published: string[];
  const tx = {} as Tx;

  beforeEach(async () => {
    published = [];
    repo = new InMemorySagaRepository();

    const outboxStub = {
      add: (_tx: unknown, routingKey: string) => {
        published.push(routingKey);
        return Promise.resolve('msg-id');
      },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        SagaOrchestrator,
        { provide: SagaRepository, useValue: repo },
        { provide: OutboxWriter, useValue: outboxStub },
      ],
    }).compile();

    orchestrator = moduleRef.get(SagaOrchestrator);
  });

  const saga = () => repo.sagas.get(SAGA_ID);
  const statusOf = () => saga()?.status;

  /** Moves the current step's deadline into the past. */
  const expireDeadline = () => {
    const current = saga()!;
    current.deadlineAt = new Date(Date.now() - 1);
  };

  it('goes STOCK → PAYMENT → COURIER on the forward path and confirms the order', async () => {
    await orchestrator.start(tx, createOrder);
    await orchestrator.onStockReserved(tx, {
      sagaId: SAGA_ID,
      orderId: ORDER_ID,
      reservationId: 'r-1',
    });
    await orchestrator.onPaymentCharged(tx, {
      sagaId: SAGA_ID,
      orderId: ORDER_ID,
      paymentId: 'p-1',
    });
    await orchestrator.onCourierAssigned(tx, {
      sagaId: SAGA_ID,
      orderId: ORDER_ID,
      courierId: 'crr-1',
    });

    expect(published).toEqual([
      Routing.ReserveStock,
      Routing.ChargePayment,
      Routing.AssignCourier,
      Routing.OrderConfirmed,
    ]);
    expect(statusOf()).toBe(SagaStatus.Confirmed);
    expect(saga()?.deadlineAt).toBeNull();
  });

  it('sums the order total over its items', async () => {
    await orchestrator.start(tx, createOrder);

    expect(saga()?.amountCents).toBe(1000);
  });

  it('arms a timer on every waiting step', async () => {
    await orchestrator.start(tx, createOrder);

    expect(saga()?.deadlineAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it('compensates nothing when the reservation is rejected — there is nothing to undo', async () => {
    await orchestrator.start(tx, createOrder);
    await orchestrator.onStockRejected(tx, {
      sagaId: SAGA_ID,
      orderId: ORDER_ID,
      reason: 'OUT_OF_STOCK',
    });

    expect(published).toEqual([Routing.ReserveStock, Routing.OrderCancelled]);
    expect(statusOf()).toBe(SagaStatus.Cancelled);
    expect(saga()?.failureReason).toBe('OUT_OF_STOCK');
  });

  it('rolls back only the reservation when payment fails', async () => {
    await orchestrator.start(tx, createOrder);
    await orchestrator.onStockReserved(tx, {
      sagaId: SAGA_ID,
      orderId: ORDER_ID,
      reservationId: 'r-1',
    });
    await orchestrator.onPaymentFailed(tx, {
      sagaId: SAGA_ID,
      orderId: ORDER_ID,
      reason: 'INSUFFICIENT_FUNDS',
    });

    expect(published).toEqual([
      Routing.ReserveStock,
      Routing.ChargePayment,
      Routing.ReleaseStock,
    ]);
    expect(statusOf()).toBe(SagaStatus.Compensating);

    await orchestrator.onStockReleased(tx, {
      sagaId: SAGA_ID,
      orderId: ORDER_ID,
      reservationId: 'r-1',
    });

    expect(published).toContain(Routing.OrderCancelled);
    expect(statusOf()).toBe(SagaStatus.Cancelled);
  });

  it('unwinds compensations in reverse order when no courier is available', async () => {
    await orchestrator.start(tx, createOrder);
    await orchestrator.onStockReserved(tx, {
      sagaId: SAGA_ID,
      orderId: ORDER_ID,
      reservationId: 'r-1',
    });
    await orchestrator.onPaymentCharged(tx, {
      sagaId: SAGA_ID,
      orderId: ORDER_ID,
      paymentId: 'p-1',
    });
    await orchestrator.onCourierUnavailable(tx, {
      sagaId: SAGA_ID,
      orderId: ORDER_ID,
      reason: 'NO_COURIER',
    });
    await orchestrator.onPaymentRefunded(tx, {
      sagaId: SAGA_ID,
      orderId: ORDER_ID,
      paymentId: 'p-1',
    });
    await orchestrator.onStockReleased(tx, {
      sagaId: SAGA_ID,
      orderId: ORDER_ID,
      reservationId: 'r-1',
    });

    // Money is refunded before the reservation is released: steps unwind in reverse.
    expect(published).toEqual([
      Routing.ReserveStock,
      Routing.ChargePayment,
      Routing.AssignCourier,
      Routing.RefundPayment,
      Routing.ReleaseStock,
      Routing.OrderCancelled,
    ]);
    expect(statusOf()).toBe(SagaStatus.Cancelled);
  });

  it('ignores a repeated reply for an already completed step', async () => {
    await orchestrator.start(tx, createOrder);

    const reserved = {
      sagaId: SAGA_ID,
      orderId: ORDER_ID,
      reservationId: 'r-1',
    };
    await orchestrator.onStockReserved(tx, reserved);
    await orchestrator.onStockReserved(tx, reserved);

    expect(published).toEqual([Routing.ReserveStock, Routing.ChargePayment]);
  });

  it('ignores a repeated start of the same saga', async () => {
    await orchestrator.start(tx, createOrder);
    await orchestrator.start(tx, createOrder);

    expect(published).toEqual([Routing.ReserveStock]);
  });

  describe('timeouts', () => {
    it('an expired step rolls the saga back with reason TIMEOUT', async () => {
      await orchestrator.start(tx, createOrder);
      await orchestrator.onStockReserved(tx, {
        sagaId: SAGA_ID,
        orderId: ORDER_ID,
        reservationId: 'r-1',
      });
      expireDeadline();

      await orchestrator.onTimeout(tx, SAGA_ID);

      expect(saga()?.failureReason).toBe('TIMEOUT');
      expect(statusOf()).toBe(SagaStatus.Compensating);
      expect(published.at(-1)).toBe(Routing.ReleaseStock);
    });

    it('does not fire before the deadline', async () => {
      await orchestrator.start(tx, createOrder);

      await orchestrator.onTimeout(tx, SAGA_ID);

      expect(statusOf()).toBe(SagaStatus.StockPending);
      expect(published).toEqual([Routing.ReserveStock]);
    });

    it('a reservation arriving after the timeout is released by its own compensation', async () => {
      await orchestrator.start(tx, createOrder);
      expireDeadline();
      await orchestrator.onTimeout(tx, SAGA_ID);
      expect(statusOf()).toBe(SagaStatus.Cancelled);

      // The warehouse did reply after all — after the saga was cancelled.
      await orchestrator.onStockReserved(tx, {
        sagaId: SAGA_ID,
        orderId: ORDER_ID,
        reservationId: 'r-late',
      });

      expect(published).toEqual([
        Routing.ReserveStock,
        Routing.OrderCancelled,
        Routing.ReleaseStock,
      ]);
      expect(statusOf()).toBe(SagaStatus.Cancelled);
    });

    it('a payment arriving after the timeout is refunded to the customer', async () => {
      await orchestrator.start(tx, createOrder);
      await orchestrator.onStockReserved(tx, {
        sagaId: SAGA_ID,
        orderId: ORDER_ID,
        reservationId: 'r-1',
      });
      expireDeadline();
      await orchestrator.onTimeout(tx, SAGA_ID);

      await orchestrator.onPaymentCharged(tx, {
        sagaId: SAGA_ID,
        orderId: ORDER_ID,
        paymentId: 'p-late',
      });

      expect(published.at(-1)).toBe(Routing.RefundPayment);
      // Confirming the late refund does not count as releasing the reservation.
      await orchestrator.onPaymentRefunded(tx, {
        sagaId: SAGA_ID,
        orderId: ORDER_ID,
        paymentId: 'p-late',
      });
      expect(statusOf()).toBe(SagaStatus.Compensating);
      expect(saga()?.awaiting).toBe('STOCK');
    });

    it('repeating an already recorded reply triggers no compensation', async () => {
      await orchestrator.start(tx, createOrder);
      const reserved = {
        sagaId: SAGA_ID,
        orderId: ORDER_ID,
        reservationId: 'r-1',
      };
      await orchestrator.onStockReserved(tx, reserved);
      await orchestrator.onPaymentFailed(tx, {
        sagaId: SAGA_ID,
        orderId: ORDER_ID,
        reason: 'PROVIDER_ERROR',
      });
      const before = [...published];

      await orchestrator.onStockReserved(tx, reserved);

      expect(published).toEqual(before);
    });

    it('a rollback timeout moves the saga to STUCK', async () => {
      await orchestrator.start(tx, createOrder);
      await orchestrator.onStockReserved(tx, {
        sagaId: SAGA_ID,
        orderId: ORDER_ID,
        reservationId: 'r-1',
      });
      await orchestrator.onPaymentFailed(tx, {
        sagaId: SAGA_ID,
        orderId: ORDER_ID,
        reason: 'PROVIDER_ERROR',
      });
      expireDeadline();

      await orchestrator.onTimeout(tx, SAGA_ID);

      expect(statusOf()).toBe(SagaStatus.Stuck);
      expect(saga()?.deadlineAt).toBeNull();
    });
  });
});
