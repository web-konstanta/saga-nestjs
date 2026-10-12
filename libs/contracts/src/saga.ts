import type { OrderItem } from './commands';

export const SagaStatus = {
  StockPending: 'STOCK_PENDING',
  PaymentPending: 'PAYMENT_PENDING',
  CourierPending: 'COURIER_PENDING',
  Compensating: 'COMPENSATING',
  Confirmed: 'CONFIRMED',
  Cancelled: 'CANCELLED',
  Stuck: 'STUCK',
} as const;

export type SagaStatus = (typeof SagaStatus)[keyof typeof SagaStatus];

/** A saga step that has a compensating action. */
export const SagaStep = {
  Stock: 'STOCK',
  Payment: 'PAYMENT',
  Courier: 'COURIER',
} as const;

export type SagaStep = (typeof SagaStep)[keyof typeof SagaStep];

export interface SagaLogEntry {
  at: string;
  note: string;
}

export interface SagaState {
  sagaId: string;
  orderId: string;
  customerId: string;
  address: string;
  items: OrderItem[];
  amountCents: number;

  status: SagaStatus;
  /** Stack of successfully completed steps. Compensations unwind it from the top. */
  completed: SagaStep[];
  /** The step whose reply the saga is waiting for right now. */
  awaiting?: SagaStep;

  reservationId?: string;
  paymentId?: string;
  courierId?: string;
  failureReason?: string;

  history: SagaLogEntry[];
}
