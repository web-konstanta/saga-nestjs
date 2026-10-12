import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxRelay } from '@app/outbox';
import { PrismaService } from './prisma.service';
import { SagaOrchestrator } from './saga.orchestrator';
import { SagaRepository } from './saga.repository';

const BATCH_SIZE = 50;

/**
 * Periodically finds sagas with an expired deadline_at and hands them to the orchestrator.
 *
 * Each saga is handled in its own transaction: one failure does not roll back
 * the others. With several orders instances two may pick up the same saga —
 * onTimeout takes the row lock and re-checks the deadline, so exactly one
 * of them fires.
 */
@Injectable()
export class SagaTimeoutWatcher
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(SagaTimeoutWatcher.name);
  private readonly intervalMs: number;
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sagas: SagaRepository,
    private readonly orchestrator: SagaOrchestrator,
    private readonly relay: OutboxRelay,
    config: ConfigService,
  ) {
    this.intervalMs = Number(config.get('SAGA_TIMEOUT_POLL_MS', 1000));
  }

  onApplicationBootstrap() {
    this.schedule();
  }

  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), this.intervalMs);
  }

  private async tick() {
    try {
      const expired = await this.sagas.findExpired(BATCH_SIZE);

      for (const sagaId of expired) {
        try {
          await this.prisma.$transaction((tx) =>
            this.orchestrator.onTimeout(tx, sagaId),
          );
        } catch (e) {
          this.logger.error(
            `[${sagaId}] timeout handling failed: ${String(e)}`,
          );
        }
      }

      if (expired.length > 0) this.relay.wake();
    } catch (e) {
      this.logger.error(`failed to look up expired sagas: ${String(e)}`);
    } finally {
      this.schedule();
    }
  }
}
