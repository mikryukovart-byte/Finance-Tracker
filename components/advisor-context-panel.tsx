"use client";

import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Notice } from "@/components/notice";
import { readErrorMessage } from "@/lib/client-api";
import type { ActiveDecision, LifeContextValue } from "@/lib/life-context";
import type { WeeklyDeliveryValue } from "@/lib/weekly-delivery";
import { defaultWeeklyDelivery } from "@/lib/weekly-delivery";

const initialLifeContext: LifeContextValue = {
  currentSituation: "",
  priorities: [],
  constraints: [],
  activeProjects: [],
  deliberatePauses: [],
  activeDecisions: [],
  notes: "",
  updatedAt: null
};

function lines(value: string[]) {
  return value.join("\n");
}

function fromLines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

const weekdays = [
  [1, "Понедельник"], [2, "Вторник"], [3, "Среда"], [4, "Четверг"],
  [5, "Пятница"], [6, "Суббота"], [7, "Воскресенье"]
] as const;

export function AdvisorContextPanel() {
  const [context, setContext] = useState<LifeContextValue>(initialLifeContext);
  const [delivery, setDelivery] = useState<WeeklyDeliveryValue>(defaultWeeklyDelivery);
  const [loading, setLoading] = useState(true);
  const [savingContext, setSavingContext] = useState(false);
  const [savingDelivery, setSavingDelivery] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"neutral" | "success" | "error">("neutral");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/life-context", { cache: "no-store" }),
      fetch("/api/advisor/settings", { cache: "no-store" })
    ]).then(async ([contextResponse, deliveryResponse]) => {
      if (!contextResponse.ok) throw new Error(await readErrorMessage(contextResponse));
      if (!deliveryResponse.ok) throw new Error(await readErrorMessage(deliveryResponse));
      const [contextData, deliveryData] = await Promise.all([
        contextResponse.json() as Promise<LifeContextValue>,
        deliveryResponse.json() as Promise<WeeklyDeliveryValue>
      ]);
      if (!cancelled) {
        setContext(contextData);
        setDelivery({
          ...deliveryData,
          timezone: deliveryData.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        });
      }
    }).catch((error) => {
      if (!cancelled) {
        setMessage(error instanceof Error ? error.message : "Не удалось загрузить текущий контекст");
        setTone("error");
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  function updateDecision(index: number, patch: Partial<ActiveDecision>) {
    setContext((current) => ({
      ...current,
      activeDecisions: current.activeDecisions.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    }));
  }

  async function saveContext() {
    setSavingContext(true);
    setMessage("");
    try {
      const response = await fetch("/api/life-context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context)
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      setContext(await response.json());
      setMessage("Текущий контекст сохранен");
      setTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить контекст");
      setTone("error");
    } finally {
      setSavingContext(false);
    }
  }

  async function saveDelivery() {
    setSavingDelivery(true);
    setMessage("");
    try {
      const response = await fetch("/api/advisor/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(delivery)
      });
      if (!response.ok) throw new Error(await readErrorMessage(response));
      setDelivery(await response.json());
      setMessage("Настройки недельного отчета сохранены");
      setTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить настройки");
      setTone("error");
    } finally {
      setSavingDelivery(false);
    }
  }

  if (loading) return <div className="mt-6 text-sm text-muted">Загрузка контекста…</div>;

  return (
    <section className="mt-6 space-y-4">
      <Notice message={message} tone={tone} />
      <details className="card p-5 sm:p-6">
        <summary className="cursor-pointer select-none text-lg font-semibold text-ink">Текущий контекст</summary>
        <p className="mt-2 text-sm text-muted">Редко меняющаяся рамка: ситуация, приоритеты, ограничения и действующие решения.</p>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <label className="lg:col-span-2">
            <span className="label">Что происходит сейчас</span>
            <textarea className="input min-h-24" value={context.currentSituation} onChange={(event) => setContext({ ...context, currentSituation: event.target.value })} />
          </label>
          {([
            ["priorities", "Приоритеты"], ["constraints", "Ограничения"],
            ["activeProjects", "Активные проекты"], ["deliberatePauses", "Сознательно на паузе"]
          ] as const).map(([key, label]) => (
            <label key={key}>
              <span className="label">{label}</span>
              <textarea className="input min-h-24" value={lines(context[key])} onChange={(event) => setContext({ ...context, [key]: fromLines(event.target.value) })} placeholder="Один пункт на строку" />
            </label>
          ))}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <span className="label">Действующие решения</span>
              <button type="button" className="btn-secondary" onClick={() => setContext({ ...context, activeDecisions: [...context.activeDecisions, { text: "", validUntil: null, status: "ACTIVE" }] })}>
                <Plus className="h-4 w-4" aria-hidden="true" /> Добавить
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {context.activeDecisions.map((decision, index) => (
                <div className="grid gap-2 md:grid-cols-[1fr_160px_150px_40px]" key={index}>
                  <input className="input" value={decision.text} onChange={(event) => updateDecision(index, { text: event.target.value })} placeholder="Текст решения" />
                  <input className="input" type="date" value={decision.validUntil ?? ""} onChange={(event) => updateDecision(index, { validUntil: event.target.value || null })} aria-label="Действует до" />
                  <select className="input" value={decision.status} onChange={(event) => updateDecision(index, { status: event.target.value as ActiveDecision["status"] })} aria-label="Статус решения">
                    <option value="ACTIVE">Действует</option><option value="COMPLETED">Выполнено</option><option value="CANCELED">Отменено</option>
                  </select>
                  <button type="button" className="icon-btn" aria-label="Удалить решение" onClick={() => setContext({ ...context, activeDecisions: context.activeDecisions.filter((_, itemIndex) => itemIndex !== index) })}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <label className="lg:col-span-2">
            <span className="label">Дополнительные заметки</span>
            <textarea className="input min-h-20" value={context.notes} onChange={(event) => setContext({ ...context, notes: event.target.value })} />
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" className="btn-primary" onClick={saveContext} disabled={savingContext}>
            <Save className="h-4 w-4" aria-hidden="true" /> {savingContext ? "Сохраняем" : "Сохранить контекст"}
          </button>
        </div>
      </details>

      <details className="card p-5 sm:p-6">
        <summary className="cursor-pointer select-none text-lg font-semibold text-ink">Недельный отчет в Telegram</summary>
        <p className="mt-2 text-sm text-muted">День и время задаются в вашем часовом поясе. Повторный отчет за ту же неделю не создается.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
            <input type="checkbox" checked={delivery.enabled} onChange={(event) => setDelivery({ ...delivery, enabled: event.target.checked })} /> Включить доставку
          </label>
          <label><span className="label">Часовой пояс</span><input className="input" value={delivery.timezone} onChange={(event) => setDelivery({ ...delivery, timezone: event.target.value })} placeholder="Europe/Moscow" /></label>
          <label><span className="label">День недели</span><select className="input" value={delivery.weekday} onChange={(event) => setDelivery({ ...delivery, weekday: Number(event.target.value) })}>{weekdays.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span className="label">Местное время</span><input className="input" type="time" value={delivery.localTime} onChange={(event) => setDelivery({ ...delivery, localTime: event.target.value })} /></label>
        </div>
        <div className="mt-4 flex justify-end"><button type="button" className="btn-secondary" onClick={saveDelivery} disabled={savingDelivery}><Save className="h-4 w-4" aria-hidden="true" /> {savingDelivery ? "Сохраняем" : "Сохранить расписание"}</button></div>
      </details>
    </section>
  );
}
