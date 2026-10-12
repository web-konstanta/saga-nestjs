import { Injectable, Logger } from '@nestjs/common';
import type {
  ChargePaymentCommand,
  RefundPaymentCommand,
} from '@app/contracts';
import type { Payment } from './generated/prisma/client';
import type { Tx } from './prisma.service';

export type ChargeResult =
  | { ok: true; paymentId: string }
  | { ok: false; reason: 'INSUFFICIENT_FUNDS' | 'PROVIDER_ERROR' };

/** A customer for whom the payment provider always fails — used to test rollback. */
const BROKEN_CUSTOMER = 'c-error';
/** A new customer gets an account with this balance (demo stand-in for a bank). */
const DEFAULT_BALANCE_CENTS = 50_000;

const toResult = (payment: Payment): ChargeResult =>
  payment.status === 'FAILED'
    ? {
        ok: false,
        reason: payment.failureReason as
          'INSUFFICIENT_FUNDS' | 'PROVIDER_ERROR',
      }
    : { ok: true, paymentId: payment.id };

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  async charge(tx: Tx, cmd: ChargePaymentCommand): Promise<ChargeResult> {
    const existing = await tx.payment.findUnique({
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
      customerId: cmd.customerId,
      amountCents: cmd.amountCents,
    };

    if (cmd.customerId === BROKEN_CUSTOMER) {
      await tx.payment.create({
        data: { ...base, status: 'FAILED', failureReason: 'PROVIDER_ERROR' },
      });
      return { ok: false, reason: 'PROVIDER_ERROR' };
    }

    await tx.account.upsert({
      where: { customerId: cmd.customerId },
      create: {
        customerId: cmd.customerId,
        balanceCents: DEFAULT_BALANCE_CENTS,
      },
      update: {},
    });

    // Check and debit in one conditional UPDATE: there is no window between
    // "read the balance" and "debit" for a concurrent payment to slip into.
    const { count } = await tx.account.updateMany({
      where: {
        customerId: cmd.customerId,
        balanceCents: { gte: cmd.amountCents },
      },
      data: { balanceCents: { decrement: cmd.amountCents } },
    });

    if (count === 0) {
      this.logger.warn(
        `insufficient funds for ${cmd.customerId} to pay ${cmd.amountCents} cents`,
      );
      await tx.payment.create({
        data: {
          ...base,
          status: 'FAILED',
          failureReason: 'INSUFFICIENT_FUNDS',
        },
      });
      return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
    }

    const payment = await tx.payment.create({
      data: { ...base, status: 'CHARGED' },
    });
    this.logger.log(
      `charged ${cmd.amountCents} cents to ${cmd.customerId}, payment ${payment.id}`,
    );
    return { ok: true, paymentId: payment.id };
  }

  /** Payment compensation. Idempotent: a repeated refund never doubles the amount. */
  async refund(tx: Tx, cmd: RefundPaymentCommand): Promise<void> {
    const payment = await tx.payment.findUnique({
      where: { id: cmd.paymentId },
    });
    if (!payment) {
      this.logger.warn(
        `payment ${cmd.paymentId} not found — treating it as refunded`,
      );
      return;
    }

    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: 'CHARGED' },
      data: { status: 'REFUNDED' },
    });
    if (count === 0) {
      this.logger.warn(`payment ${cmd.paymentId} already refunded`);
      return;
    }

    await tx.account.update({
      where: { customerId: payment.customerId },
      data: { balanceCents: { increment: payment.amountCents } },
    });
    this.logger.log(
      `refunded ${payment.amountCents} cents to ${payment.customerId}`,
    );
  }
}
