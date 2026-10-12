export interface OrderItem {
  sku: string;
  qty: number;
  priceCents: number;
}

export interface CreateOrderCommand {
  sagaId: string;
  orderId: string;
  customerId: string;
  address: string;
  items: OrderItem[];
}

export interface ReserveStockCommand {
  sagaId: string;
  orderId: string;
  items: OrderItem[];
  idempotencyKey: string;
}

export interface ReleaseStockCommand {
  sagaId: string;
  orderId: string;
  reservationId: string;
  idempotencyKey: string;
}

export interface ChargePaymentCommand {
  sagaId: string;
  orderId: string;
  customerId: string;
  amountCents: number;
  idempotencyKey: string;
}

export interface RefundPaymentCommand {
  sagaId: string;
  orderId: string;
  paymentId: string;
  idempotencyKey: string;
}

export interface AssignCourierCommand {
  sagaId: string;
  orderId: string;
  address: string;
  idempotencyKey: string;
}

export interface UnassignCourierCommand {
  sagaId: string;
  orderId: string;
  courierId: string;
  idempotencyKey: string;
}
