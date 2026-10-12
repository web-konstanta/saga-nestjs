-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('RESERVED', 'REJECTED', 'RELEASED');

-- CreateTable
CREATE TABLE "stock_items" (
    "sku" TEXT NOT NULL,
    "available" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("sku")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "saga_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" "ReservationStatus" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_items" (
    "id" SERIAL NOT NULL,
    "reservation_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "reservation_items_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "reservations_idempotency_key_key" ON "reservations"("idempotency_key");

-- CreateIndex
CREATE INDEX "reservations_saga_id_idx" ON "reservations"("saga_id");

-- CreateIndex
CREATE INDEX "reservation_items_reservation_id_idx" ON "reservation_items"("reservation_id");

-- CreateIndex
CREATE INDEX "outbox_messages_published_at_created_at_idx" ON "outbox_messages"("published_at", "created_at");

-- CreateIndex
CREATE INDEX "inbox_messages_processed_at_idx" ON "inbox_messages"("processed_at");

-- AddForeignKey
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Added manually: Prisma cannot express CHECK constraints in the schema.
-- The last line of defence against negative stock caused by a bug in code.
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_available_non_negative" CHECK ("available" >= 0);
ALTER TABLE "reservation_items" ADD CONSTRAINT "reservation_items_qty_positive" CHECK ("qty" > 0);
