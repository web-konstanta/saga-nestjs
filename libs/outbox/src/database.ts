/**
 * The minimum @app/outbox needs from a service's Prisma client.
 *
 * Each service has its own generated client with its own models, so the library
 * imports none of them: it describes the required shape structurally and works
 * with the outbox_messages / inbox_messages tables through raw SQL. The tables
 * themselves are declared identically in every service's schema.prisma.
 */
export interface SqlExecutor {
  $executeRaw(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): PromiseLike<number>;
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): PromiseLike<T>;
}

export interface TransactionalDatabase extends SqlExecutor {
  $transaction<R>(
    fn: (tx: SqlExecutor) => PromiseLike<R>,
    options?: { maxWait?: number; timeout?: number },
  ): PromiseLike<R>;
}

/** DI token: the service's PrismaService that the outbox and inbox run on. */
export const OUTBOX_DATABASE = Symbol('OUTBOX_DATABASE');
