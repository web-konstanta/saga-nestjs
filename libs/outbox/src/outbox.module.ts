import { DynamicModule, Module, Type } from '@nestjs/common';
import { MessagingModule } from '@app/messaging';
import { OUTBOX_DATABASE } from './database';
import type { TransactionalDatabase } from './database';
import { InboxProcessor } from './inbox.processor';
import { OutboxRelay } from './outbox.relay';
import { OutboxWriter } from './outbox.writer';

export interface OutboxModuleOptions {
  /** The service's PrismaService. The module registers it itself and exports it. */
  database: Type<TransactionalDatabase>;
}

/**
 * Wires the transactional outbox/inbox into a service:
 *
 *   imports: [OutboxModule.forRoot({ database: PrismaService })]
 *
 * The service then gets PrismaService, OutboxWriter (writes outgoing messages),
 * InboxProcessor (receives incoming ones) and OutboxRelay (background sending).
 */
@Module({})
export class OutboxModule {
  static forRoot({ database }: OutboxModuleOptions): DynamicModule {
    return {
      module: OutboxModule,
      imports: [MessagingModule],
      providers: [
        database,
        { provide: OUTBOX_DATABASE, useExisting: database },
        OutboxWriter,
        OutboxRelay,
        InboxProcessor,
      ],
      exports: [database, OutboxWriter, OutboxRelay, InboxProcessor],
    };
  }
}
