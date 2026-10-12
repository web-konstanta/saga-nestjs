export interface OrderConfirmedEvent {
  sagaId: string;
  orderId: string;
  customerId: string;
  courierId: string;
  amountCents: number;
}

export interface OrderCancelledEvent {
  sagaId: string;
  orderId: string;
  customerId: string;
  reason: string;
}
