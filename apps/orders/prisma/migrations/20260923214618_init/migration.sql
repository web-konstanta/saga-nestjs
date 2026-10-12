-- CreateEnum
CREATE TYPE "SagaStatus" AS ENUM ('STOCK_PENDING', 'PAYMENT_PENDING', 'COURIER_PENDING', 'COMPENSATING', 'CONFIRMED', 'CANCELLED', 'STUCK');

-- CreateEnum
CREATE TYPE "SagaStep" AS ENUM ('STOCK', 'PAYMENT', 'COURIER');

-- CreateTable
CREATE TABLE "sagas" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "customer_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "SagaStatus" NOT NULL,
    "completed" "SagaStep"[],
    "awaiting" "SagaStep",
    "reservation_id" TEXT,
    "payment_id" TEXT,
    "courier_id" TEXT,
    "failure_reason" TEXT,
    "deadline_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sagas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saga_items" (
    "id" SERIAL NOT NULL,
    "saga_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,

    CONSTRAINT "saga_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saga_log" (
    "id" BIGSERIAL NOT NULL,
    "saga_id" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL,

    CONSTRAINT "saga_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "routing_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_error" TEXT,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_messages" (
    "message_id" TEXT NOT NULL,
    "handler" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_messages_pkey" PRIMARY KEY ("message_id","handler")
);

-- CreateIndex
CREATE UNIQUE INDEX "sagas_order_id_key" ON "sagas"("order_id");

-- CreateIndex
CREATE INDEX "sagas_deadline_at_idx" ON "sagas"("deadline_at");

-- CreateIndex
CREATE INDEX "sagas_created_at_idx" ON "sagas"("created_at");

-- CreateIndex
CREATE INDEX "saga_items_saga_id_idx" ON "saga_items"("saga_id");

-- CreateIndex
CREATE INDEX "saga_log_saga_id_id_idx" ON "saga_log"("saga_id", "id");

-- CreateIndex
CREATE INDEX "outbox_messages_published_at_created_at_idx" ON "outbox_messages"("published_at", "created_at");

-- CreateIndex
CREATE INDEX "inbox_messages_processed_at_idx" ON "inbox_messages"("processed_at");

-- AddForeignKey
ALTER TABLE "saga_items" ADD CONSTRAINT "saga_items_saga_id_fkey" FOREIGN KEY ("saga_id") REFERENCES "sagas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saga_log" ADD CONSTRAINT "saga_log_saga_id_fkey" FOREIGN KEY ("saga_id") REFERENCES "sagas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
