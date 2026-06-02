"use client";

import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { FieldError, Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import {
  fetchCategories,
  invalidateCategoriesCache,
  readErrorMessage,
  setCachedCategories
} from "@/lib/client-api";
import { typeLabels } from "@/lib/format";
import type { Category, CategoryKind } from "@/types/finance";

type CategoryForm = {
  name: string;
  type: CategoryKind;
};

type CategoryErrors = Partial<Record<keyof CategoryForm, string>>;

const initialForm: CategoryForm = {
  name: "",
  type: "EXPENSE"
};

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function CategoriesClient() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<CategoryForm>(initialForm);
  const [errors, setErrors] = useState<CategoryErrors>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "success" | "error">("neutral");

  const incomeCategories = useMemo(
    () => categories.filter((category) => category.type === "INCOME"),
    [categories]
  );
  const expenseCategories = useMemo(
    () => categories.filter((category) => category.type === "EXPENSE"),
    [categories]
  );

  const totalUsage = useMemo(
    () =>
      categories.reduce((sum, category) => sum + (category._count?.transactions ?? 0), 0),
    [categories]
  );
  const editingCategory = useMemo(
    () => categories.find((category) => category.id === editingId) ?? null,
    [categories, editingId]
  );
  const editingUsageCount = editingCategory?._count?.transactions ?? 0;

  async function loadCategories(showLoader = true) {
    if (showLoader) {
      setLoading(true);
    }

    try {
      setCategories(await fetchCategories({ force: showLoader }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Неизвестная ошибка");
      setMessageTone("error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCategories();
  }, []);

  function resetForm() {
    setForm(initialForm);
    setErrors({});
    setEditingId(null);
  }

  function editCategory(category: Category) {
    setEditingId(category.id);
    setForm({
      name: category.name,
      type: category.type
    });
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function validateForm() {
    const nextErrors: CategoryErrors = {};
    const normalized = normalizeName(form.name);

    if (normalized.length < 2) {
      nextErrors.name = "Название должно быть не короче 2 символов";
    }

    const duplicate = categories.some(
      (category) =>
        category.id !== editingId &&
        category.type === form.type &&
        category.name.toLocaleLowerCase("ru-RU") === normalized.toLocaleLowerCase("ru-RU")
    );

    if (duplicate) {
      nextErrors.name = "Такая категория уже существует";
    }

    setErrors(nextErrors);

    return {
      valid: Object.keys(nextErrors).length === 0,
      normalized
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const validation = validateForm();

    if (!validation.valid) {
      setMessage("Проверьте поля формы");
      setMessageTone("error");
      return;
    }

    setSaving(true);

    const url = editingId ? `/api/categories/${editingId}` : "/api/categories";
    const method = editingId ? "PUT" : "POST";

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: validation.normalized, type: form.type })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      invalidateCategoriesCache();
      await loadCategories(false);
      resetForm();
      setMessage(editingId ? "Категория обновлена" : "Категория создана");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Неизвестная ошибка");
      setMessageTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCategory(category: Category) {
    const usageCount = category._count?.transactions ?? 0;

    if (usageCount > 0) {
      setMessage("Категорию с операциями нельзя удалить. Сначала перенесите операции.");
      setMessageTone("error");
      return;
    }

    const confirmed = window.confirm(`Удалить категорию «${category.name}»?`);

    if (!confirmed) {
      return;
    }

    setMessage("");

    try {
      const response = await fetch(`/api/categories/${category.id}`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      setCategories((current) => {
        const nextCategories = current.filter((item) => item.id !== category.id);
        setCachedCategories(nextCategories);
        return nextCategories;
      });
      if (editingId === category.id) {
        resetForm();
      }
      setMessage("Категория удалена");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Неизвестная ошибка");
      setMessageTone("error");
    }
  }

  function renderCategoryList(title: string, items: Category[], tone: "income" | "expense") {
    return (
      <section className="card p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <span className="rounded-full bg-soft px-2 py-1 text-xs text-muted">
            {items.length}
          </span>
        </div>

        {items.length === 0 ? (
          <EmptyState text="Категорий пока нет" />
        ) : (
          <div className="space-y-2">
            {items.map((category) => {
              const usageCount = category._count?.transactions ?? 0;

              return (
                <div
                  key={category.id}
                  className="flex flex-col gap-3 rounded-md border border-line px-3 py-3 transition hover:bg-soft/50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{category.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          tone === "income"
                            ? "bg-profit/10 text-profit"
                            : "bg-loss/10 text-loss"
                        }`}
                      >
                        {typeLabels[category.type]}
                      </span>
                      <span>Операций: {usageCount}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-secondary px-2"
                      onClick={() => editCategory(category)}
                      aria-label="Редактировать категорию"
                      title="Редактировать"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn-danger px-2"
                      onClick={() => deleteCategory(category)}
                      aria-label="Удалить категорию"
                      title={
                        usageCount > 0
                          ? "Нельзя удалить категорию с операциями"
                          : "Удалить"
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  return (
    <div>
      <PageHeader
        title="Категории"
        description="Поддерживайте понятную структуру доходов и расходов без дублей."
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="card p-4">
          <p className="text-sm text-muted">Категорий расходов</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{expenseCategories.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-muted">Категорий доходов</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{incomeCategories.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-muted">Связанных операций</p>
          <p className="mt-2 text-2xl font-semibold text-ink">{totalUsage}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <section className="card p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">
              {editingId ? "Редактирование" : "Новая категория"}
            </h2>
            {editingId ? (
              <button type="button" className="btn-secondary" onClick={resetForm}>
                <X className="h-4 w-4" aria-hidden="true" />
                Отмена
              </button>
            ) : null}
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="field-label" htmlFor="categoryName">
                Название
              </label>
              <input
                id="categoryName"
                className="field mt-1"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Например, Продукты"
                autoComplete="off"
              />
              <FieldError message={errors.name} />
            </div>

            <div>
              <label className="field-label" htmlFor="categoryType">
                Тип категории
              </label>
              <select
                id="categoryType"
                className="field mt-1"
                value={form.type}
                disabled={editingUsageCount > 0}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    type: event.target.value as CategoryKind
                  }))
                }
              >
                <option value="EXPENSE">Расход</option>
                <option value="INCOME">Доход</option>
              </select>
              {editingUsageCount > 0 ? (
                <p className="mt-1 text-xs text-muted">
                  Тип нельзя изменить: категорию используют операции ({editingUsageCount}).
                </p>
              ) : null}
            </div>

            <Notice message={message} tone={messageTone} />

            <button type="submit" className="btn-primary w-full" disabled={saving}>
              {editingId ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              {saving ? "Сохранение" : editingId ? "Сохранить" : "Создать"}
            </button>
          </form>
        </section>

        {loading ? (
          <div>
            <p className="mb-3 text-sm text-muted">Загрузка...</p>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="card h-64 animate-pulse bg-soft/50" />
              <div className="card h-64 animate-pulse bg-soft/50" />
            </div>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {renderCategoryList("Расходы", expenseCategories, "expense")}
            {renderCategoryList("Доходы", incomeCategories, "income")}
          </div>
        )}
      </div>
    </div>
  );
}
