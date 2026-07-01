import { Prisma } from "@prisma/client";

import { downloadTelegramVoice, sendTelegramMessage, answerTelegramCallback } from "@/lib/telegram-api";
import {
  parseTelegramDailyAction,
  telegramDailyActionSchema,
  transcribeTelegramVoice,
  type TelegramDailyAction
} from "@/lib/telegram-daily-actions";
import { parseDateInput, startOfWeek } from "@/lib/date-ranges";
import { prisma } from "@/lib/prisma";
import type { TelegramRuntimeConfig } from "@/lib/telegram-auth";
import type { TelegramWebhookDependencies } from "@/lib/telegram-webhook-core";

const pendingLifetimeMs = 30 * 60 * 1000;

async function removeExpiredPendingActions(now = new Date()) {
  await prisma.telegramPendingAction.deleteMany({
    where: { expiresAt: { lte: now } }
  });
}

async function createPending(chatId: string, action: TelegramDailyAction) {
  const now = new Date();
  await removeExpiredPendingActions(now);
  const pending = await prisma.telegramPendingAction.create({
    data: {
      chatId,
      payload: action as Prisma.InputJsonObject,
      expiresAt: new Date(now.getTime() + pendingLifetimeMs)
    },
    select: { id: true }
  });
  return pending.id;
}

async function cancelPending(chatId: string, pendingId: string) {
  const result = await prisma.telegramPendingAction.deleteMany({
    where: {
      id: pendingId,
      chatId,
      expiresAt: { gt: new Date() }
    }
  });
  return result.count === 1;
}

async function savePending(
  chatId: string,
  pendingId: string,
  trackerUserId: string
) {
  return prisma.$transaction(async (transaction) => {
    const pending = await transaction.telegramPendingAction.findFirst({
      where: {
        id: pendingId,
        chatId,
        expiresAt: { gt: new Date() }
      },
      select: { payload: true }
    });

    if (!pending) {
      return null;
    }

    const payload = telegramDailyActionSchema.safeParse(pending.payload);
    const date = payload.success ? parseDateInput(payload.data.date) : null;

    if (!payload.success || !date) {
      await transaction.telegramPendingAction.deleteMany({
        where: { id: pendingId, chatId }
      });
      return null;
    }

    const claimed = await transaction.telegramPendingAction.deleteMany({
      where: {
        id: pendingId,
        chatId,
        expiresAt: { gt: new Date() }
      }
    });

    if (claimed.count !== 1) {
      return null;
    }

    const created = await transaction.dailyActionLog.create({
      data: {
        userId: trackerUserId,
        date,
        weekStartDate: startOfWeek(date),
        type: payload.data.type,
        target: payload.data.target,
        value: payload.data.value,
        nextStep: payload.data.nextStep,
        note: payload.data.note
      },
      select: { target: true }
    });

    return { type: payload.data.type, target: created.target };
  });
}

export function createTelegramDependencies(
  config: TelegramRuntimeConfig
): TelegramWebhookDependencies {
  return {
    parseAction: (text) => parseTelegramDailyAction(text),
    transcribeVoice: async (fileId) => {
      const audio = await downloadTelegramVoice(config.botToken, fileId);
      return transcribeTelegramVoice(audio);
    },
    createPending,
    cancelPending,
    savePending: (chatId, pendingId) =>
      savePending(chatId, pendingId, config.trackerUserId),
    sendMessage: (chatId, text, replyMarkup) =>
      sendTelegramMessage(config.botToken, chatId, text, replyMarkup),
    answerCallback: (callbackQueryId, text) =>
      answerTelegramCallback(config.botToken, callbackQueryId, text)
  };
}
