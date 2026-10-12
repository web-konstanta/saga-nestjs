import { Body, Controller, Post } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RabbitPublisher } from '@app/messaging';
import { Routing } from '@app/contracts';
import type { CreateOrderCommand } from '@app/contracts';
import { CreateOrderDto } from './dto/create-order.dto';

/**
 * The HTTP entry point. It decides nothing itself: it generates ids and hands
 * the command to the orchestrator without waiting for the saga outcome. A 201
 * means "order accepted for processing", not "order placed".
 */
@Controller('orders')
export class GatewayController {
  constructor(private readonly publisher: RabbitPublisher) {}

  @Post()
  async create(@Body() body: CreateOrderDto) {
    const sagaId = randomUUID();
    const orderId = randomUUID();

    const command: CreateOrderCommand = {
      sagaId,
      orderId,
      customerId: body.customerId,
      address: body.address,
      items: body.items,
    };

    await this.publisher.publish(Routing.CreateOrder, command);

    return {
      sagaId,
      orderId,
      status: 'ACCEPTED',
      watch: `/sagas/${sagaId}`,
    };
  }
}
