"use client";

import { AlertTriangle, Check, Download, RotateCcw, Save, Trash2, Upload, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import {
  downloadJson,
  invalidateFinancialDataCache,
  readErrorMessage
} from "@/lib/client-api";
import {
  defaultSettings,
  parseSettings,
  storageKey,
  type SettingsState
} from "@/lib/settings";

export function SettingsClient() {
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "success" | "error">("neutral");
  const [backupBusy, setBackupBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetStep, setResetStep] = useState<1 | 2>(1);
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState("");
  const [resetMessageTone, setResetMessageTone] = useState<"neutral" | "success" | "error">(
    "neutral"
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resetInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSettings(parseSettings(window.localStorage.getItem(storageKey)));
  }, []);

  useEffect(() => {
    if (resetOpen && resetStep === 2) {
      window.setTimeout(() => resetInputRef.current?.focus(), 0);
    }
  }, [resetOpen, resetStep]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const limit = Number(settings.monthlyLimit);
    const leakageThreshold = Number(settings.leakageThreshold);

    if (settings.monthlyLimit && (!Number.isFinite(limit) || limit < 0)) {
      setMessage("Месячный лимит не может быть отрицательным");
      setMessageTone("error");
      return;
    }

    if (
      settings.leakageThreshold &&
      (!Number.isFinite(leakageThreshold) || leakageThreshold <= 0)
    ) {
      setMessage("Порог мелких расходов должен быть больше нуля");
      setMessageTone("error");
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(settings));
    window.dispatchEvent(new Event("finance-settings-changed"));
    setSaved(true);
    setMessage("Настройки сохранены");
    setMessageTone("success");
    window.setTimeout(() => setSaved(false), 1800);
  }

  function resetSettings() {
    setSettings(defaultSettings);
    window.localStorage.removeItem(storageKey);
    window.dispatchEvent(new Event("finance-settings-changed"));
    setSaved(false);
    setMessage("Настройки сброшены");
    setMessageTone("success");
  }

  async function exportBackup() {
    setBackupBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/backup", { cache: "no-store" });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = await response.json();
      const date = new Date().toISOString().slice(0, 10);
      downloadJson(`finance-backup-${date}.json`, data);
      setMessage("Резервная копия подготовлена");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось экспортировать данные");
      setMessageTone("error");
    } finally {
      setBackupBusy(false);
    }
  }

  async function importBackup(file: File | undefined) {
    if (!file) {
      return;
    }

    setBackupBusy(true);
    setMessage("");

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const result = await response.json();
      setMessage(
        `Импортировано: категорий ${result.imported.categories}, операций ${result.imported.transactions}, кредитов ${result.imported.loans}`
      );
      invalidateFinancialDataCache();
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось импортировать данные");
      setMessageTone("error");
    } finally {
      setBackupBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function openResetModal() {
    setResetOpen(true);
    setResetStep(1);
    setResetPhrase("");
    setResetMessage("");
  }

  function closeResetModal() {
    if (resetBusy) {
      return;
    }

    setResetOpen(false);
    setResetStep(1);
    setResetPhrase("");
  }

  async function resetAllData() {
    if (resetPhrase !== "СБРОС") {
      setResetMessage("Введите СБРОС для подтверждения");
      setResetMessageTone("error");
      return;
    }

    setResetBusy(true);
    setResetMessage("");

    try {
      const response = await fetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: resetPhrase })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const result = await response.json();
      setResetOpen(false);
      setResetStep(1);
      setResetPhrase("");
      setMessage("");
      setResetMessage(result.message ?? "Все данные сброшены");
      setResetMessageTone("success");
      invalidateFinancialDataCache();
      window.dispatchEvent(new Event("finance-data-reset"));
    } catch (error) {
      setResetMessage(error instanceof Error ? error.message : "Не удалось сбросить данные");
      setResetMessageTone("error");
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Настройки"
        description="Локальные параметры, резервные копии и служебная информация."
      />

      <form className="grid gap-6 xl:grid-cols-[480px_1fr]" onSubmit={handleSubmit}>
        <section className="card p-4 sm:p-5">
          <h2 className="text-lg font-semibold text-ink">Параметры</h2>

          <div className="mt-5 space-y-4">
            <div>
              <label className="field-label" htmlFor="currency">
                Валюта
              </label>
              <select
                id="currency"
                className="field mt-1"
                value={settings.currency}
                onChange={() => undefined}
                disabled
              >
                <option value="RUB">Российский рубль</option>
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="monthlyLimit">
                Месячный лимит расходов
              </label>
              <input
                id="monthlyLimit"
                className="field mt-1"
                inputMode="decimal"
                min="0"
                step="0.01"
                type="number"
                value={settings.monthlyLimit}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    monthlyLimit: event.target.value
                  }))
                }
                placeholder="Например, 120000"
              />
            </div>

            <div>
              <label className="field-label" htmlFor="leakageThreshold">
                Порог мелких расходов
              </label>
              <input
                id="leakageThreshold"
                className="field mt-1"
                inputMode="decimal"
                min="1"
                step="1"
                type="number"
                value={settings.leakageThreshold}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    leakageThreshold: event.target.value
                  }))
                }
                placeholder="1000"
              />
            </div>

            <label className="flex items-center justify-between gap-4 rounded-md border border-line px-3 py-3 transition hover:bg-soft/50">
              <span>
                <span className="block text-sm font-medium text-ink">Компактные таблицы</span>
                <span className="block text-sm text-muted">Меньше вертикальных отступов</span>
              </span>
              <input
                className="h-5 w-5 accent-ink"
                type="checkbox"
                checked={settings.compactTables}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    compactTables: event.target.checked
                  }))
                }
              />
            </label>
          </div>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button type="submit" className="btn-primary">
              {saved ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              Сохранить
            </button>
            <button type="button" className="btn-secondary" onClick={resetSettings}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Сбросить
            </button>
          </div>

          <div className="mt-4">
            <Notice message={message} tone={messageTone} />
          </div>
        </section>

        <div className="space-y-6">
          <section className="card p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-ink">Резервная копия</h2>
            <p className="mt-1 text-sm text-muted">
              Экспортируйте все категории, операции и кредиты в JSON или импортируйте копию обратно.
            </p>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="btn-secondary"
                onClick={exportBackup}
                disabled={backupBusy}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Экспорт JSON
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={backupBusy}
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                Импорт JSON
              </button>
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept="application/json,.json"
                onChange={(event) => importBackup(event.target.files?.[0])}
              />
            </div>
          </section>

          <section className="card p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-ink">Хранилище</h2>
            <div className="mt-5 divide-y divide-line rounded-lg border border-line">
              <div className="flex items-center justify-between gap-4 px-3 py-3">
                <span className="text-sm text-muted">База данных</span>
                <span className="text-sm font-medium text-ink">SQLite</span>
              </div>
              <div className="flex items-center justify-between gap-4 px-3 py-3">
                <span className="text-sm text-muted">ORM</span>
                <span className="text-sm font-medium text-ink">Prisma</span>
              </div>
              <div className="flex items-center justify-between gap-4 px-3 py-3">
                <span className="text-sm text-muted">Интерфейс</span>
                <span className="text-sm font-medium text-ink">Next.js</span>
              </div>
            </div>
          </section>
        </div>
      </form>

      <section className="card mt-6 border-loss/30 p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-loss">Опасная зона</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Сброс удалит операции, долги и пользовательские категории. Системные категории будут
              восстановлены автоматически.
            </p>
          </div>
          <button type="button" className="btn-danger shrink-0" onClick={openResetModal}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Сбросить все данные
          </button>
        </div>

        <div className="mt-4">
          <Notice message={resetMessage} tone={resetMessageTone} />
        </div>
      </section>

      {resetOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="resetDataTitle"
        >
          <div className="w-full max-w-md rounded-md border border-line bg-paper p-5 shadow-soft">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-md border border-loss/30 bg-loss/10 text-loss">
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                </span>
                <h2 id="resetDataTitle" className="text-lg font-semibold text-ink">
                  Сброс данных
                </h2>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-muted transition hover:bg-soft hover:text-ink"
                onClick={closeResetModal}
                aria-label="Закрыть"
                disabled={resetBusy}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {resetStep === 1 ? (
              <>
                <p className="mt-5 text-sm leading-6 text-ink">
                  Это действие удалит ВСЕ операции, долги и пользовательские категории. Продолжить?
                </p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button type="button" className="btn-secondary" onClick={closeResetModal}>
                    Отмена
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => setResetStep(2)}
                  >
                    Продолжить
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="field-label mt-5 block" htmlFor="resetConfirmation">
                  Введите СБРОС
                </label>
                <input
                  ref={resetInputRef}
                  id="resetConfirmation"
                  className="field mt-2"
                  value={resetPhrase}
                  onChange={(event) => setResetPhrase(event.target.value)}
                  placeholder="СБРОС"
                  autoComplete="off"
                />
                <p className="mt-2 text-xs text-muted">
                  Финальное подтверждение станет доступно только при точном совпадении.
                </p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setResetStep(1)}
                    disabled={resetBusy}
                  >
                    Назад
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={resetAllData}
                    disabled={resetBusy || resetPhrase !== "СБРОС"}
                  >
                    {resetBusy ? "Сброс" : "Удалить данные"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
