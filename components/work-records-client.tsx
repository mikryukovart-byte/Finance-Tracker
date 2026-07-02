"use client";

import { useCallback, useEffect, useState } from "react";

import { Notice } from "@/components/notice";
import { readErrorMessage } from "@/lib/client-api";
import type { WorkRecord, WorkRecordType } from "@/types/finance";

const typeOptions: Array<{ value: WorkRecordType; label: string }> = [
  { value: "NOTE", label: "Заметка" },
  { value: "DECISION", label: "Решение" },
  { value: "RISK", label: "Риск" },
  { value: "IDEA", label: "Идея" },
  { value: "DAILY_REFLECTION", label: "Итоги дня" },
  { value: "WEEKLY_PLAN_DRAFT", label: "Черновик плана недели" },
  { value: "HYPOTHESIS_DRAFT", label: "Черновик гипотезы" },
  { value: "ACTION_CANDIDATE", label: "Кандидат в действие" }
];

const typeLabels = Object.fromEntries(
  typeOptions.map((option) => [option.value, option.label])
) as Record<WorkRecordType, string>;

function formatRecordDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function WorkRecordsClient() {
  const [records, setRecords] = useState<WorkRecord[]>([]);
  const [type, setType] = useState<"" | WorkRecordType>("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"success" | "error" | "neutral">("neutral");

  const loadRecords = useCallback(async () => {
    setLoading(true);

    try {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (includeDeleted) params.set("includeDeleted", "true");
      const response = await fetch(`/api/work-records?${params.toString()}`, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = (await response.json()) as { records: WorkRecord[] };
      setRecords(data.records);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить записи");
      setTone("error");
    } finally {
      setLoading(false);
    }
  }, [includeDeleted, type]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  async function setDeleted(record: WorkRecord, restore: boolean) {
    setBusyId(record.id);

    try {
      const response = await fetch(`/api/work-records/${record.id}`, {
        method: restore ? "PATCH" : "DELETE",
        headers: restore ? { "Content-Type": "application/json" } : undefined,
        body: restore ? JSON.stringify({ restore: true }) : undefined
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setMessage(restore ? "Запись восстановлена" : "Запись удалена");
      setTone("success");
      await loadRecords();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось изменить запись");
      setTone("error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5" data-testid="work-records-list">
      <Notice message={message} tone={tone} />

      <div className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full sm:max-w-sm">
          <label className="field-label" htmlFor="workRecordType">
            Тип записи
          </label>
          <select
            id="workRecordType"
            className="field mt-1 min-h-11"
            value={type}
            onChange={(event) => setType(event.target.value as "" | WorkRecordType)}
          >
            <option value="">Все типы</option>
            {typeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex min-h-11 items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(event) => setIncludeDeleted(event.target.checked)}
          />
          Показать удалённые
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Загрузка...</p>
      ) : records.length === 0 ? (
        <div className="card p-5 text-sm text-muted">
          Подтверждённые рабочие записи появятся здесь после сохранения в Telegram.
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((record) => (
            <article
              key={record.id}
              className={`card p-4 sm:p-5 ${record.deletedAt ? "opacity-60" : ""}`}
              data-testid="work-record"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{typeLabels[record.recordType]}</span>
                    <span>·</span>
                    <time dateTime={record.createdAt}>{formatRecordDate(record.createdAt)}</time>
                    {record.deletedAt ? <span>· удалена</span> : null}
                  </div>
                  <h2 className="mt-2 text-base font-semibold text-ink">{record.title}</h2>
                  <p className="mt-2 whitespace-pre-line text-sm text-ink">{record.summary}</p>
                </div>

                <button
                  type="button"
                  className="btn-secondary min-h-9 shrink-0 px-3 text-xs"
                  disabled={busyId === record.id}
                  onClick={() => void setDeleted(record, Boolean(record.deletedAt))}
                >
                  {record.deletedAt ? "Восстановить" : "Удалить"}
                </button>
              </div>

              {record.insight || record.risk || record.nextStep ? (
                <dl className="mt-4 grid gap-3 border-t border-line pt-4 text-sm md:grid-cols-3">
                  {record.insight ? (
                    <div><dt className="text-muted">Вывод</dt><dd className="mt-1 text-ink">{record.insight}</dd></div>
                  ) : null}
                  {record.risk ? (
                    <div><dt className="text-muted">Риск</dt><dd className="mt-1 text-ink">{record.risk}</dd></div>
                  ) : null}
                  {record.nextStep ? (
                    <div><dt className="text-muted">Следующий шаг</dt><dd className="mt-1 text-ink">{record.nextStep}</dd></div>
                  ) : null}
                </dl>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
