import {
  Controller,
  DefaultValuePipe,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { SagaRepository } from './saga.repository';

const MAX_LIST_LIMIT = 500;

/**
 * An HTTP window into saga state. Only for observing how orders progress:
 * GET /sagas?limit=200   — the most recent sagas
 * GET /sagas/:sagaId     — full state with the transition history
 */
@Controller('sagas')
export class SagasController {
  constructor(private readonly sagas: SagaRepository) {}

  @Get()
  list(@Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit: number) {
    return this.sagas.listRecent(Math.min(Math.max(limit, 1), MAX_LIST_LIMIT));
  }

  @Get(':sagaId')
  async byId(@Param('sagaId', ParseUUIDPipe) sagaId: string) {
    const saga = await this.sagas.findState(sagaId);

    if (!saga) {
      throw new NotFoundException(`saga ${sagaId} not found`);
    }

    return saga;
  }
}
