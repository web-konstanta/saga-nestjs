export const EXCHANGE = 'delivery.events';
export const DLX = 'delivery.dlx';

export const Routing = {
  // gateway → orchestrator
  CreateOrder: 'orders.create',

  // orchestrator → services: forward commands
  ReserveStock: 'inventory.reserve_stock',
  ChargePayment: 'payments.charge',
  AssignCourier: 'couriers.assign',

  // orchestrator → services: compensating commands
  ReleaseStock: 'inventory.release_stock',
  RefundPayment: 'payments.refund',
  UnassignCourier: 'couriers.unassign',

  // services → orchestrator: replies to forward commands
  StockReserved: 'orders.stock_reserved',
  StockRejected: 'orders.stock_rejected',
  PaymentCharged: 'orders.payment_charged',
  PaymentFailed: 'orders.payment_failed',
  CourierAssigned: 'orders.courier_assigned',
  CourierUnavailable: 'orders.courier_unavailable',

  // services → orchestrator: compensation confirmations
  StockReleased: 'orders.stock_released',
  PaymentRefunded: 'orders.payment_refunded',
  CourierUnassigned: 'orders.courier_unassigned',

  // domain events for the outside world
  OrderConfirmed: 'order.confirmed',
  OrderCancelled: 'order.cancelled',
} as const;
