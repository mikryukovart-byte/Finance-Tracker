import { Prisma } from "@prisma/client";

import { downloadTelegramVoice, sendTelegramMessage, answerTelegramCallback } from "@/lib/telegram-api";
import {
  parseTelegramDailyAction,
  telegramDailyActionSchema,
  todayInAmsterdam,
  transcribeTelegramVoice,
  type TelegramDailyAction
} from "@/lib/telegram-daily-actions";
import {
  parseTelegramWorkRecord,
  telegramWorkRecordSchema,
  type TelegramWorkRecord
} from "@/lib/telegram-work-records";
import {
  classifyTelegramInput,
  parseTelegramJournal,
  telegramJournalSchema,
  type TelegramJournal
} from "@/lib/journal";
import { generateAndSaveDailyFeedback } from "@/lib/daily-feedback";
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

async function removeExpiredPendingWorkRecords(now = new Date()) {
  await prisma.telegramPendingWorkRecord.deleteMany({
    where: { expiresAt: { lte: now } }
  });
}

async function createPendingWorkRecord(chatId: string, record: TelegramWorkRecord) {
  const now = new Date();
  await removeExpiredPendingWorkRecords(now);
  const pending = await prisma.telegramPendingWorkRecord.create({
    data: {
      chatId,
      payload: record as Prisma.InputJsonObject,
      expiresAt: new Date(now.getTime() + pendingLifetimeMs)
    },
    select: { id: true }
  });
  return pending.id;
}

async function removeExpiredPendingJournals(now = new Date()) {
  await prisma.telegramPendingJournal.deleteMany({
    where: { expiresAt: { lte: now } }
  });
}

async function createPendingJournal(chatId: string, entry: TelegramJournal) {
  const now = new Date();
  await removeExpiredPendingJournals(now);
  const pending = await prisma.telegramPendingJournal.create({
    data: {
      chatId,
      payload: entry as Prisma.InputJsonObject,
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

async function cancelPendingWorkRecord(chatId: string, pendingId: string) {
  const result = await prisma.telegramPendingWorkRecord.deleteMany({
    where: {
      id: pendingId,
      chatId,
      expiresAt: { gt: new Date() }
    }
  });
  return result.count === 1;
}

async function cancelPendingJournal(chatId: string, pendingId: string) {
  const result = await prisma.telegramPendingJournal.deleteMany({
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

async function savePendingWorkRecord(
  chatId: string,
  pendingId: string,
  trackerUserId: string
) {
  return prisma.$transaction(async (transaction) => {
    const pending = await transaction.telegramPendingWorkRecord.findFirst({
      where: {
        id: pendingId,
        chatId,
        expiresAt: { gt: new Date() }
      },
      select: { payload: true }
    });

    if (!pending) {
      return false;
    }

    const payload = telegramWorkRecordSchema.safeParse(pending.payload);
    const relatedWeekStart = payload.success && payload.data.relatedWeekStart
      ? parseDateInput(payload.data.relatedWeekStart)
      : null;

    if (!payload.success || (payload.data.relatedWeekStart && !relatedWeekStart)) {
      await transaction.telegramPendingWorkRecord.deleteMany({
        where: { id: pendingId, chatId }
      });
      return false;
    }

    const claimed = await transaction.telegramPendingWorkRecord.deleteMany({
      where: {
        id: pendingId,
        chatId,
        expiresAt: { gt: new Date() }
      }
    });

    if (claimed.count !== 1) {
      return false;
    }

    await transaction.workRecord.create({
      data: {
        userId: trackerUserId,
        title: payload.data.title,
        recordType: payload.data.recordType,
        summary: payload.data.summary,
        insight: payload.data.insight,
        risk: payload.data.risk,
        nextStep: payload.data.nextStep,
        relatedWeekStart,
        source: payload.data.source
      }
    });

    return true;
  });
}

async function savePendingJournal(
  chatId: string,
  pendingId: string,
  trackerUserId: string
) {
  const saved = await prisma.$transaction(async (transaction) => {
    const pending = await transaction.telegramPendingJournal.findFirst({
      where: {
        id: pendingId,
        chatId,
        expiresAt: { gt: new Date() }
      },
      select: { payload: true }
    });

    if (!pending) return null;

    const payload = telegramJournalSchema.safeParse(pending.payload);
    const entryDate = payload.success ? parseDateInput(payload.data.entryDate) : null;

    if (!payload.success || !entryDate) {
      await transaction.telegramPendingJournal.deleteMany({ where: { id: pendingId, chatId } });
      return null;
    }

    const claimed = await transaction.telegramPendingJournal.deleteMany({
      where: { id: pendingId, chatId, expiresAt: { gt: new Date() } }
    });
    if (claimed.count !== 1) return null;

    return transaction.journalEntry.create({
      data: {
        userId: trackerUserId,
        entryDate,
        source: payload.data.source,
        cleanedText: payload.data.cleanedText,
        summary: payload.data.summary,
        domains: payload.data.domains as Prisma.InputJsonArray,
        keyEvents: payload.data.keyEvents
          ? payload.data.keyEvents as Prisma.InputJsonArray
          : Prisma.DbNull,
        tensions: payload.data.tensions
          ? payload.data.tensions as Prisma.InputJsonArray
          : Prisma.DbNull,
        decisions: payload.data.decisions
          ? payload.data.decisions as Prisma.InputJsonArray
          : Prisma.DbNull,
        questions: payload.data.questions
          ? payload.data.questions as Prisma.InputJsonArray
          : Prisma.DbNull,
        nextStep: payload.data.nextStep,
        importance: payload.data.importance
      },
      select: { id: true, summary: true }
    });
  });

  if (!saved) return null;

  try {
    const generated = await generateAndSaveDailyFeedback(trackerUserId, saved.id);
    return { ...saved, feedback: generated.feedback };
  } catch (error) {
    console.error("Telegram journal feedback failed", {
      entryId: saved.id,
      message: error instanceof Error ? error.message : "unknown"
    });
    return saved;
  }
}

function fallbackActionFromRecord(record: TelegramWorkRecord): TelegramDailyAction {
  const actionText = record.nextStep || `${record.title}. ${record.summary}`;
  return {
    type: "OTHER",
    date: todayInAmsterdam(),
    target: null,
    value: record.summary.slice(0, 300),
    nextStep: record.nextStep?.slice(0, 300) || null,
    note: actionText.slice(0, 4096)
  };
}

async function convertPendingWorkRecord(chatId: string, pendingId: string) {
  const pending = await prisma.telegramPendingWorkRecord.findFirst({
    where: {
      id: pendingId,
      chatId,
      expiresAt: { gt: new Date() }
    },
    select: { payload: true }
  });
  const payload = telegramWorkRecordSchema.safeParse(pending?.payload);

  if (!payload.success) {
    return null;
  }

  const actionText = payload.data.nextStep || `${payload.data.title}. ${payload.data.summary}`;
  const parsedAction = await parseTelegramDailyAction(actionText).catch(() => null);
  const action = parsedAction || fallbackActionFromRecord(payload.data);
  const claimed = await prisma.telegramPendingWorkRecord.deleteMany({
    where: {
      id: pendingId,
      chatId,
      expiresAt: { gt: new Date() }
    }
  });

  if (claimed.count !== 1) {
    return null;
  }

  return { pendingId: await createPending(chatId, action), action };
}

export function createTelegramDependencies(
  config: TelegramRuntimeConfig
): TelegramWebhookDependencies {
  return {
    classifyInput: classifyTelegramInput,
    parseAction: (text) => parseTelegramDailyAction(text),
    parseWorkRecord: (text, source) => parseTelegramWorkRecord(text, source),
    parseJournal: (text, source) => parseTelegramJournal(text, source),
    transcribeVoice: async (fileId) => {
      const audio = await downloadTelegramVoice(config.botToken, fileId);
      return transcribeTelegramVoice(audio);
    },
    createPending,
    createPendingWorkRecord,
    createPendingJournal,
    cancelPending,
    cancelPendingWorkRecord,
    cancelPendingJournal,
    savePending: (chatId, pendingId) =>
      savePending(chatId, pendingId, config.trackerUserId),
    savePendingWorkRecord: (chatId, pendingId) =>
      savePendingWorkRecord(chatId, pendingId, config.trackerUserId),
    savePendingJournal: (chatId, pendingId) =>
      savePendingJournal(chatId, pendingId, config.trackerUserId),
    convertPendingWorkRecord,
    sendMessage: (chatId, text, replyMarkup) =>
      sendTelegramMessage(config.botToken, chatId, text, replyMarkup),
    answerCallback: (callbackQueryId, text) =>
      answerTelegramCallback(config.botToken, callbackQueryId, text)
  };
}
