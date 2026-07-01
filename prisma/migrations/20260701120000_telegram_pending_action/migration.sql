CREATE TABLE IF NOT EXISTS "TelegramPendingAction" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramPendingAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TelegramPendingAction_chatId_expiresAt_idx"
ON "TelegramPendingAction"("chatId", "expiresAt");

CREATE INDEX IF NOT EXISTS "TelegramPendingAction_expiresAt_idx"
ON "TelegramPendingAction"("expiresAt");

ALTER TABLE public."TelegramPendingAction" ENABLE ROW LEVEL SECURITY;
