import { Injectable } from '@nestjs/common';
import type { SagaState } from '@app/contracts';
import type { Prisma } from './generated/prisma/client';
import { PrismaService } from './prisma.service';

export type Tx = Prisma.TransactionClient;

/**
 * The orchestrator's working view of a saga: everything except the history.
 * History is append-only (note) and only the HTTP read side needs all of it.
 */
export type SagaEntity = Omit<SagaState, 'history'> & {
  /** When waiting for the current step counts as failed; null means no timer is armed. */
  deadlineAt: Date | null;
};

export interface SagaSummary {
  sagaId: string;
  orderId: string;
  status: SagaState['status'];
  failureReason?: string;
}

type SagaRow = Prisma.SagaGetPayload<{ include: { items: true } }>;

const toEntity = (row: SagaRow): SagaEntity => ({
  sagaId: row.id,
  orderId: row.orderId,
  customerId: row.customerId,
  address: row.address,
  items: row.items.map(({ sku, qty, priceCents }) => ({
    sku,
    qty,
    priceCents,
  })),
  amountCents: row.amountCents,
  status: row.status,
  completed: row.completed,
  awaiting: row.awaiting ?? undefined,
  reservationId: row.reservationId ?? undefined,
  paymentId: row.paymentId ?? undefined,
  courierId: row.courierId ?? undefined,
  failureReason: row.failureReason ?? undefined,
  deadlineAt: row.deadlineAt,
});

/**
 * Saga storage in orders_db. Every write method takes a transaction: the state
 * write and the outgoing messages in the outbox must commit together.
 */
@Injectable()
export class SagaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async exists(tx: Tx, sagaId: string): Promise<boolean> {
    return (await tx.saga.count({ where: { id: sagaId } })) > 0;
  }

  async create(tx: Tx, saga: SagaEntity): Promise<void> {
    await tx.saga.create({
      data: {
        id: saga.sagaId,
        orderId: saga.orderId,
        customerId: saga.customerId,
        address: saga.address,
        amountCents: saga.amountCents,
        status: saga.status,
        completed: saga.completed,
        awaiting: saga.awaiting ?? null,
        deadlineAt: saga.deadlineAt,
        items: { create: saga.items },
      },
    });
  }

  /**
   * Reads the saga and locks its row until the end of the transaction (SELECT … FOR UPDATE).
   * A participant's reply and a timeout for the same saga must not recompute its
   * state at the same time — the second waits for the first.
   */
  async lock(tx: Tx, sagaId: string): Promise<SagaEntity | undefined> {
    await tx.$queryRaw`SELECT 1 FROM sagas WHERE id = ${sagaId}::uuid FOR UPDATE`;
    const row = await tx.saga.findUnique({
      where: { id: sagaId },
      include: { items: true },
    });
    return row ? toEntity(row) : undefined;
  }

  async save(tx: Tx, saga: SagaEntity): Promise<void> {
    await tx.saga.update({
      where: { id: saga.sagaId },
      data: {
        status: saga.status,
        completed: saga.completed,
        awaiting: saga.awaiting ?? null,
        reservationId: saga.reservationId ?? null,
        paymentId: saga.paymentId ?? null,
        courierId: saga.courierId ?? null,
        failureReason: saga.failureReason ?? null,
        deadlineAt: saga.deadlineAt,
      },
    });
  }

  async note(tx: Tx, sagaId: string, note: string): Promise<void> {
    await tx.sagaLogEntry.create({ data: { sagaId, note } });
  }

  /** Sagas whose step deadline has passed — candidates for timeout handling. */
  async findExpired(limit: number): Promise<string[]> {
    const rows = await this.prisma.saga.findMany({
      where: { deadlineAt: { lte: new Date() } },
      orderBy: { deadlineAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  // ─────────────── HTTP read side ───────────────

  async findState(sagaId: string): Promise<SagaState | undefined> {
    const row = await this.prisma.saga.findUnique({
      where: { id: sagaId },
      include: { items: true, history: { orderBy: { id: 'asc' } } },
    });
    if (!row) return undefined;

    const state: SagaState & { deadlineAt?: Date | null } = {
      ...toEntity(row),
      history: row.history.map((h) => ({
        at: h.at.toISOString(),
        note: h.note,
      })),
    };
    // The deadline is an orchestrator internal; it is not part of the SagaState contract.
    delete state.deadlineAt;
    return state;
  }

  /** Most recent sagas, oldest first — the order the in-memory Map used to return. */
  async listRecent(limit: number): Promise<SagaSummary[]> {
    const rows = await this.prisma.saga.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, orderId: true, status: true, failureReason: true },
    });
    return rows.reverse().map((r) => ({
      sagaId: r.id,
      orderId: r.orderId,
      status: r.status,
      failureReason: r.failureReason ?? undefined,
    }));
  }
}
