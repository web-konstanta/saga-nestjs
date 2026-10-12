import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { InboxProcessor, OutboxWriter } from '@app/outbox';
import { Routing } from '@app/contracts';
import type {
  ReleaseStockCommand,
  ReserveStockCommand,
  StockRejectedEvent,
  StockReleasedEvent,
  StockReservedEvent,
} from '@app/contracts';
import { InventoryService } from './inventory.service';
import type { Tx } from './prisma.service';

/**
 * The stock change and the reply to the orchestrator are written in one transaction:
 * the reply lands in the outbox and reaches RabbitMQ only if the reservation commits.
 */
@Controller()
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly inbox: InboxProcessor,
    private readonly outbox: OutboxWriter,
  ) {}

  /** Forward saga step: reserve stock. */
  @EventPattern<string>(Routing.ReserveStock)
  async reserve(@Payload() data: ReserveStockCommand, @Ctx() ctx: RmqContext) {
    await this.inbox.handle<Tx>(ctx, Routing.ReserveStock, async (tx) => {
      const result = await this.inventory.reserve(tx, data);

      if (result.ok) {
        const event: StockReservedEvent = {
          sagaId: data.sagaId,
          orderId: data.orderId,
          reservationId: result.reservationId,
        };
        await this.outbox.add(tx, Routing.StockReserved, event);
        return;
      }

      const event: StockRejectedEvent = {
        sagaId: data.sagaId,
        orderId: data.orderId,
        reason: result.reason,
      };
      await this.outbox.add(tx, Routing.StockRejected, event);
    });
  }

  /** Compensation: return stock to the warehouse. */
  @EventPattern<string>(Routing.ReleaseStock)
  async release(@Payload() data: ReleaseStockCommand, @Ctx() ctx: RmqContext) {
    await this.inbox.handle<Tx>(ctx, Routing.ReleaseStock, async (tx) => {
      await this.inventory.release(tx, data);

      const event: StockReleasedEvent = {
        sagaId: data.sagaId,
        orderId: data.orderId,
        reservationId: data.reservationId,
      };
      await this.outbox.add(tx, Routing.StockReleased, event);
    });
  }
}
