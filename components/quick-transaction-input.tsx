"use client";

import { CornerDownLeft, Plus } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchCategories,
  invalidateCategoriesCache,
  readErrorMessage,
  setCachedCategories
} from "@/lib/client-api";
import { toDateInputValue, typeLabels } from "@/lib/format";
import type { Category, TransactionKind } from "@/types/finance";

type QuickTransactionInputProps = {
  title?: string;
  onAdded?: () => Promise<void> | void;
};

type ParsedTransaction = {
  amount: number;
  description: string;
  categoryName: string;
  type: TransactionKind;
};

type ManualState = ParsedTransaction & {
  categoryId: string;
};

function safeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function parseAmount(value: unknown) {
  if (typeof value !== "string") {
    return Number.NaN;
  }

  return Number(value.replace(/\s/g, "").replace(",", "."));
}

function normalize(value: unknown) {
  return safeString(value).trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

function formatCategoryName(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return "";
  }

  return normalized.charAt(0).toLocaleUpperCase("ru-RU") + normalized.slice(1);
}

function parseText(value: unknown): ParsedTransaction | null {
  const rawValue = safeString(value).trim();

  if (!rawValue) {
    return null;
  }

  const matches = Array.from(rawValue.matchAll(/\d[\d\s]*(?:[,.]\d{1,2})?/g));
  const lastMatch = matches.at(-1);

  if (!lastMatch || lastMatch.index === undefined) {
    return null;
  }

  const amount = parseAmount(lastMatch[0]);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const description = normalize(
    `${rawValue.slice(0, lastMatch.index)} ${rawValue.slice(lastMatch.index + lastMatch[0].length)}`
  );
  const type = /\b(доход|зарплата|гонорар|оплата|перевод)\b/.test(description)
    ? "INCOME"
    : "EXPENSE";
  const categoryName = formatCategoryName(description);

  if (!categoryName) {
    return null;
  }

  return {
    amount,
    categoryName,
    description,
    type
  };
}

function findCategory(categories: Category[], type: TransactionKind, name: string) {
  const normalizedName = normalize(name);

  return categories.find(
    (category) => category.type === type && normalize(category.name) === normalizedName
  );
}

export function QuickTransactionInput({
  title = "Быстрый ввод",
  onAdded
}: QuickTransactionInputProps) {
  const [text, setText] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [manual, setManual] = useState<ManualState | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    async function loadCategories() {
      try {
        setCategories(await fetchCategories());
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Не удалось загрузить категории");
      }
    }

    loadCategories();
  }, []);

  const manualCategories = useMemo(
    () => categories.filter((category) => category.type === manual?.type),
    [categories, manual?.type]
  );

  async function createCategory(parsed: ParsedTransaction) {
    const existing = findCategory(categories, parsed.type, parsed.categoryName);

    if (existing) {
      return existing;
    }

    const response = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: parsed.categoryName,
        type: parsed.type
      })
    });

    if (response.status === 409) {
      const latestCategories = await fetchCategories({ force: true });
      setCategories(latestCategories);
      const latestExisting = findCategory(latestCategories, parsed.type, parsed.categoryName);

      if (latestExisting) {
        return latestExisting;
      }
    }

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const category: Category = await response.json();
    setCategories((current) => {
      const withoutDuplicate = current.filter(
        (item) =>
          item.type !== category.type || normalize(item.name) !== normalize(category.name)
      );
      const nextCategories = [...withoutDuplicate, category];

      setCachedCategories(nextCategories);
      return nextCategories;
    });

    return category;
  }

  async function createTransaction(parsed: ParsedTransaction, categoryId: string) {
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parsed.amount,
          categoryId,
          date: toDateInputValue(),
          description: parsed.description,
          type: parsed.type
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setText("");
      setManual(null);
      setMessage("Операция добавлена");
      invalidateCategoriesCache();
      await onAdded?.();
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось добавить операцию");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (manual) {
      if (!manual.categoryId) {
        setMessage("Выберите категорию");
        return;
      }

      await createTransaction(manual, manual.categoryId);
      return;
    }

    const parsed = parseText(text);

    if (!parsed) {
      setMessage("Введите сумму и описание");
      inputRef.current?.focus();
      return;
    }

    try {
      const category = await createCategory(parsed);
      await createTransaction(parsed, category.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось добавить операцию");
      return;
    }
  }

  return (
    <section className="card p-3 sm:p-4">
      <form className="space-y-3" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor="quickTransactionText">
            {title}
          </label>
          <input
            ref={inputRef}
            id="quickTransactionText"
            className="field"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setManual(null);
              setMessage("");
            }}
            placeholder="кофе 350, такси 1200, доход 50000"
            autoComplete="off"
          />
          <button type="submit" className="btn-primary shrink-0" disabled={saving}>
            {saving ? (
              "Сохранение"
            ) : (
              <>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Добавить
              </>
            )}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>{title}</span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Enter
          </span>
        </div>

        {manual ? (
          <div className="grid gap-2 rounded-md border border-line bg-paper/40 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
            {manualCategories.length ? (
              <div>
                <label className="field-label" htmlFor="quickManualCategory">
                  Категория для «{typeLabels[manual.type]}»
                </label>
                <select
                  id="quickManualCategory"
                  className="field mt-1"
                  value={manual.categoryId}
                  onChange={(event) =>
                    setManual((current) =>
                      current ? { ...current, categoryId: event.target.value } : current
                    )
                  }
                >
                  {manualCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="text-sm text-muted">
                Создайте категорию для типа «{typeLabels[manual.type]}».
              </div>
            )}
            <Link href="/categories" className="btn-secondary">
              Категории
            </Link>
          </div>
        ) : null}

        {message ? <p className="text-sm text-muted">{message}</p> : null}
      </form>
    </section>
  );
}
