export interface StockReservedEvent {
  sagaId: string;
  orderId: string;
  reservationId: string;
}

export interface StockRejectedEvent {
  sagaId: string;
  orderId: string;
  reason: 'OUT_OF_STOCK' | 'UNKNOWN_SKU';
}

export interface StockReleasedEvent {
  sagaId: string;
  orderId: string;
  reservationId: string;
}

export interface PaymentChargedEvent {
  sagaId: string;
  orderId: string;
  paymentId: string;
}

export interface PaymentFailedEvent {
  sagaId: string;
  orderId: string;
  reason: 'INSUFFICIENT_FUNDS' | 'PROVIDER_ERROR';
}

export interface PaymentRefundedEvent {
  sagaId: string;
  orderId: string;
  paymentId: string;
}

export interface CourierAssignedEvent {
  sagaId: string;
  orderId: string;
  courierId: string;
}

export interface CourierUnavailableEvent {
  sagaId: string;
  orderId: string;
  reason: 'NO_COURIER' | 'OUT_OF_ZONE';
}

export interface CourierUnassignedEvent {
  sagaId: string;
  orderId: string;
  courierId: string;
}
