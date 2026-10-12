-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'REJECTED', 'RELEASED');

-- CreateTable
CREATE TABLE "couriers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "current_order_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "couriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_assignments" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "saga_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "courier_id" TEXT,
    "status" "AssignmentStatus" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "courier_assignments_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "couriers_current_order_id_key" ON "couriers"("current_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "courier_assignments_idempotency_key_key" ON "courier_assignments"("idempotency_key");

-- CreateIndex
CREATE INDEX "courier_assignments_saga_id_idx" ON "courier_assignments"("saga_id");

-- CreateIndex
CREATE INDEX "outbox_messages_published_at_created_at_idx" ON "outbox_messages"("published_at", "created_at");

-- CreateIndex
CREATE INDEX "inbox_messages_processed_at_idx" ON "inbox_messages"("processed_at");
