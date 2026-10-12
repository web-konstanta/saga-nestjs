import { Injectable, Logger } from '@nestjs/common';
import type { ReleaseStockCommand, ReserveStockCommand } from '@app/contracts';
import type { Reservation } from './generated/prisma/client';
import type { Tx } from './prisma.service';

export type ReserveResult =
  | { ok: true; reservationId: string }
  | { ok: false; reason: 'OUT_OF_STOCK' | 'UNKNOWN_SKU' };

const toResult = (reservation: Reservation): ReserveResult =>
  reservation.status === 'REJECTED'
    ? {
        ok: false,
        reason: reservation.reason as 'OUT_OF_STOCK' | 'UNKNOWN_SKU',
      }
    : { ok: true, reservationId: reservation.id };

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  async reserve(tx: Tx, cmd: ReserveStockCommand): Promise<ReserveResult> {
    // At-least-once delivery: the same command may arrive twice, even with
    // different messageIds (e.g. if the orchestrator resends it). A repeat must
    // return the same reply and never deduct stock a second time.
    const existing = await tx.reservation.findUnique({
      where: { idempotencyKey: cmd.idempotencyKey },
    });
    if (existing) {
      this.logger.log(
        `repeat of ${cmd.idempotencyKey} — returning the previous reply`,
      );
      return toResult(existing);
    }

    const skus = [...new Set(cmd.items.map((item) => item.sku))].sort();

    // Lock the stock rows until the end of the transaction. Sorting by sku gives
    // every transaction the same lock order — no deadlocks.
    const rows = await tx.$queryRaw<{ sku: string; available: number }[]>`
      SELECT sku, available FROM stock_items
      WHERE sku = ANY(${skus}::text[])
      ORDER BY sku
      FOR UPDATE
    `;

    // Work on a copy: the order is reserved either entirely or not at all.
    // The copy also handles the same sku appearing twice in an order.
    const projected = new Map(rows.map((r) => [r.sku, r.available]));
    let reason: 'OUT_OF_STOCK' | 'UNKNOWN_SKU' | undefined;

    for (const item of cmd.items) {
      const available = projected.get(item.sku);
      if (available === undefined) {
        reason = 'UNKNOWN_SKU';
        break;
      }
      if (available < item.qty) {
        reason = 'OUT_OF_STOCK';
        break;
      }
      projected.set(item.sku, available - item.qty);
    }

    const items = { create: cmd.items.map(({ sku, qty }) => ({ sku, qty })) };

    if (reason) {
      await tx.reservation.create({
        data: {
          idempotencyKey: cmd.idempotencyKey,
          sagaId: cmd.sagaId,
          orderId: cmd.orderId,
          status: 'REJECTED',
          reason,
          items,
        },
      });
      this.logger.warn(
        `order ${cmd.orderId}: reservation rejected (${reason})`,
      );
      return { ok: false, reason };
    }

    for (const [sku, available] of projected) {
      await tx.stockItem.update({ where: { sku }, data: { available } });
    }

    const reservation = await tx.reservation.create({
      data: {
        idempotencyKey: cmd.idempotencyKey,
        sagaId: cmd.sagaId,
        orderId: cmd.orderId,
        status: 'RESERVED',
        items,
      },
    });

    this.logger.log(
      `reservation ${reservation.id} for order ${cmd.orderId}: ${JSON.stringify(cmd.items)}`,
    );
    return { ok: true, reservationId: reservation.id };
  }

  /**
   * Reservation compensation. Idempotent and always succeeds: if the reservation
   * is already gone, it was released earlier — the same outcome for the saga.
   */
  async release(tx: Tx, cmd: ReleaseStockCommand): Promise<void> {
    // A conditional UPDATE is an atomic "not released yet" check: of two concurrent
    // repeats, only one returns the stock.
    const { count } = await tx.reservation.updateMany({
      where: { id: cmd.reservationId, status: 'RESERVED' },
      data: { status: 'RELEASED' },
    });

    if (count === 0) {
      this.logger.warn(
        `reservation ${cmd.reservationId} not found or already released — treating it as released`,
      );
      return;
    }

    const items = await tx.reservationItem.findMany({
      where: { reservationId: cmd.reservationId },
    });
    for (const item of items) {
      await tx.stockItem.update({
        where: { sku: item.sku },
        data: { available: { increment: item.qty } },
      });
    }

    this.logger.log(
      `reservation ${cmd.reservationId} released, stock returned`,
    );
  }
}
