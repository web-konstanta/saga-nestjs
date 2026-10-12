import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import type { SagaState } from '@app/contracts';
import { OrdersClient } from './orders.client';

/**
 * The public way to watch an order's saga. Proxies to the orders read side,
 * which is not exposed outside the backend.
 * GET /sagas?limit=200   — the most recent sagas
 * GET /sagas/:sagaId     — full state with the transition history
 */
@Controller('sagas')
export class SagasController {
  constructor(private readonly orders: OrdersClient) {}

  @Get()
  list(@Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit: number) {
    return this.orders.get<unknown[]>(`/sagas?limit=${limit}`);
  }

  @Get(':sagaId')
  byId(@Param('sagaId', ParseUUIDPipe) sagaId: string) {
    return this.orders.get<SagaState>(`/sagas/${sagaId}`);
  }
}
