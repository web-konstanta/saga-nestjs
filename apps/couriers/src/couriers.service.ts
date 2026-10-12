import { Injectable, Logger } from '@nestjs/common';
import type {
  AssignCourierCommand,
  UnassignCourierCommand,
} from '@app/contracts';
import type { CourierAssignment } from './generated/prisma/client';
import type { Tx } from './prisma.service';

export type AssignResult =
  | { ok: true; courierId: string }
  | { ok: false; reason: 'NO_COURIER' | 'OUT_OF_ZONE' };

/** An address containing this substring is outside the delivery zone — used to test rollback. */
const OUT_OF_ZONE_MARKER = 'no-zone';

const toResult = (assignment: CourierAssignment): AssignResult =>
  assignment.status === 'REJECTED' || !assignment.courierId
    ? { ok: false, reason: assignment.reason as 'NO_COURIER' | 'OUT_OF_ZONE' }
    : { ok: true, courierId: assignment.courierId };

@Injectable()
export class CouriersService {
  private readonly logger = new Logger(CouriersService.name);

  async assign(tx: Tx, cmd: AssignCourierCommand): Promise<AssignResult> {
    const existing = await tx.courierAssignment.findUnique({
      where: { idempotencyKey: cmd.idempotencyKey },
    });
    if (existing) {
      this.logger.log(
        `repeat of ${cmd.idempotencyKey} — returning the previous reply`,
      );
      return toResult(existing);
    }

    const base = {
      idempotencyKey: cmd.idempotencyKey,
      sagaId: cmd.sagaId,
      orderId: cmd.orderId,
    };

    if (cmd.address.includes(OUT_OF_ZONE_MARKER)) {
      await tx.courierAssignment.create({
        data: { ...base, status: 'REJECTED', reason: 'OUT_OF_ZONE' },
      });
      return { ok: false, reason: 'OUT_OF_ZONE' };
    }

    // SKIP LOCKED: a courier being assigned by a concurrent transaction right now
    // is simply skipped — two orders never get the same courier, and nobody
    // waits on someone else's lock.
    const [free] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM couriers
      WHERE current_order_id IS NULL
      ORDER BY id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    if (!free) {
      this.logger.warn('no free couriers');
      await tx.courierAssignment.create({
        data: { ...base, status: 'REJECTED', reason: 'NO_COURIER' },
      });
      return { ok: false, reason: 'NO_COURIER' };
    }

    await tx.courier.update({
      where: { id: free.id },
      data: { currentOrderId: cmd.orderId },
    });
    await tx.courierAssignment.create({
      data: { ...base, status: 'ASSIGNED', courierId: free.id },
    });

    this.logger.log(`courier ${free.id} assigned to order ${cmd.orderId}`);
    return { ok: true, courierId: free.id };
  }

  /** Compensation: return the courier to the pool. Idempotent. */
  async unassign(tx: Tx, cmd: UnassignCourierCommand): Promise<void> {
    const { count } = await tx.courier.updateMany({
      where: { id: cmd.courierId, currentOrderId: cmd.orderId },
      data: { currentOrderId: null },
    });
    await tx.courierAssignment.updateMany({
      where: { sagaId: cmd.sagaId, status: 'ASSIGNED' },
      data: { status: 'RELEASED' },
    });

    if (count === 0) {
      this.logger.warn(
        `courier ${cmd.courierId} is not on order ${cmd.orderId} — treating it as released`,
      );
      return;
    }
    this.logger.log(`courier ${cmd.courierId} released`);
  }
}
