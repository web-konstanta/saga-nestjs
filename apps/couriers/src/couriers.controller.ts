import { Controller } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { InboxProcessor, OutboxWriter } from '@app/outbox';
import { Routing } from '@app/contracts';
import type {
  AssignCourierCommand,
  CourierAssignedEvent,
  CourierUnassignedEvent,
  CourierUnavailableEvent,
  UnassignCourierCommand,
} from '@app/contracts';
import { CouriersService } from './couriers.service';
import type { Tx } from './prisma.service';

@Controller()
export class CouriersController {
  constructor(
    private readonly couriers: CouriersService,
    private readonly inbox: InboxProcessor,
    private readonly outbox: OutboxWriter,
  ) {}

  /** Forward saga step: assign a courier. */
  @EventPattern<string>(Routing.AssignCourier)
  async assign(@Payload() data: AssignCourierCommand, @Ctx() ctx: RmqContext) {
    await this.inbox.handle<Tx>(ctx, Routing.AssignCourier, async (tx) => {
      const result = await this.couriers.assign(tx, data);

      if (result.ok) {
        const event: CourierAssignedEvent = {
          sagaId: data.sagaId,
          orderId: data.orderId,
          courierId: result.courierId,
        };
        await this.outbox.add(tx, Routing.CourierAssigned, event);
        return;
      }

      const event: CourierUnavailableEvent = {
        sagaId: data.sagaId,
        orderId: data.orderId,
        reason: result.reason,
      };
      await this.outbox.add(tx, Routing.CourierUnavailable, event);
    });
  }

  /** Compensation: release the courier from the order. */
  @EventPattern<string>(Routing.UnassignCourier)
  async unassign(
    @Payload() data: UnassignCourierCommand,
    @Ctx() ctx: RmqContext,
  ) {
    await this.inbox.handle<Tx>(ctx, Routing.UnassignCourier, async (tx) => {
      await this.couriers.unassign(tx, data);

      const event: CourierUnassignedEvent = {
        sagaId: data.sagaId,
        orderId: data.orderId,
        courierId: data.courierId,
      };
      await this.outbox.add(tx, Routing.CourierUnassigned, event);
    });
  }
}
