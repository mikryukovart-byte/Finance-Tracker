"use client";

import { ArrowRightLeft, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { FieldError, Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  accountCacheKey,
  fetchAccounts,
  fetchJsonCached,
  invalidateFinancialDataCache,
  readClientCache,
  readErrorMessage
} from "@/lib/client-api";
import { formatCurrency, formatDate, toDateInputValue } from "@/lib/format";
import type { Account, AccountType, CurrencyCode, Transfer } from "@/types/finance";

type AccountForm = {
  name: string;
  type: AccountType;
  balance: string;
  currency: CurrencyCode;
  creditLimit: string;
  currentDebt: string;
  availableCredit: string;
  minimalPayment: string;
  paymentDate: string;
  interestRate: string;
};

type TransferForm = {
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  date: string;
  description: string;
};

type AdjustmentForm = {
  accountId: string;
  balance: string;
  creditLimit: string;
  currentDebt: string;
  availableCredit: string;
  minimalPayment: string;
  paymentDate: string;
  interestRate: string;
  date: string;
  description: string;
};

type DeleteFlow = {
  account: Account;
  step: "choices" | "move" | "destroy";
  targetAccountId: string;
  confirmText: string;
  saving: boolean;
  error: string;
};

type FormErrors = Partial<Record<keyof AccountForm | keyof TransferForm | "adjustment", string>>;
const transfersCacheKey = "transfers:recent";

const initialAccountForm: AccountForm = {
  name: "",
  type: "DEBIT",
  balance: "0",
  currency: "RUB",
  creditLimit: "",
  currentDebt: "0",
  availableCredit: "0",
  minimalPayment: "",
  paymentDate: "",
  interestRate: ""
};

function parseAmount(value: string) {
  return Number(value.trim().replace(/\s/g, "").replace(",", "."));
}

function parseOptionalAmount(value: string) {
  if (!value.trim()) {
    return null;
  }

  return parseAmount(value);
}

function getAvailableLimit(account: Account) {
  return account.availableCredit ?? 0;
}

function getOverLimit(account: Account) {
  return Math.max(0, account.currentDebt - (account.creditLimit ?? 0));
}

function getAssetBalance(accounts: Account[]) {
  return accounts
    .filter((account) => account.type !== "CREDIT_CARD")
    .reduce((sum, account) => sum + Math.max(0, account.balance), 0);
}

function createTransferForm(accounts: Account[]): TransferForm {
  return {
    fromAccountId: accounts[0]?.id ?? "",
    toAccountId: accounts[1]?.id ?? accounts[0]?.id ?? "",
    amount: "",
    date: toDateInputValue(),
    description: ""
  };
}

function createAdjustmentForm(accounts: Account[]): AdjustmentForm {
  return {
    accountId: accounts[0]?.id ?? "",
    balance: "",
    creditLimit: "",
    currentDebt: "",
    availableCredit: "",
    minimalPayment: "",
    paymentDate: "",
    interestRate: "",
    date: toDateInputValue(),
    description: ""
  };
}

function createAdjustmentFormForAccount(account: Account | undefined): AdjustmentForm {
  if (!account) {
    return createAdjustmentForm([]);
  }

  return {
    accountId: account.id,
    balance: String(account.balance),
    creditLimit: account.creditLimit ? String(account.creditLimit) : "",
    currentDebt: String(account.currentDebt ?? 0),
    availableCredit: String(account.availableCredit ?? 0),
    minimalPayment: account.minimalPayment ? String(account.minimalPayment) : "",
    paymentDate: account.paymentDate ? toDateInputValue(new Date(account.paymentDate)) : "",
    interestRate:
      account.interestRate !== null && account.interestRate !== undefined
        ? String(account.interestRate)
        : "",
    date: toDateInputValue(),
    description: ""
  };
}

function getLinkedDataCount(account: Account) {
  return (
    (account._count?.transactions ?? 0) +
    (account._count?.linkedLoans ?? 0) +
    (account._count?.outgoingTransfers ?? 0) +
    (account._count?.incomingTransfers ?? 0)
  );
}

function getTransferCount(account: Account) {
  return (account._count?.outgoingTransfers ?? 0) + (account._count?.incomingTransfers ?? 0);
}

export function AccountsClient() {
  const [accounts, setAccounts] = useState<Account[]>(
    () =>
      readClientCache<{ accounts: Account[]; totalBalance: number }>(
        accountCacheKey(true)
      )?.accounts ?? []
  );
  const [transfers, setTransfers] = useState<Transfer[]>(
    () => readClientCache<Transfer[]>(transfersCacheKey) ?? []
  );
  const [form, setForm] = useState<AccountForm>(initialAccountForm);
  const [transferForm, setTransferForm] = useState<TransferForm>(() => createTransferForm([]));
  const [adjustmentForm, setAdjustmentForm] = useState<AdjustmentForm>(() =>
    createAdjustmentForm([])
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeAdjustmentAccountId, setActiveAdjustmentAccountId] = useState<string>("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(() => accounts.length === 0 && transfers.length === 0);
  const [saving, setSaving] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [deleteFlow, setDeleteFlow] = useState<DeleteFlow | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "success" | "error">("neutral");
  const adjustmentSectionRef = useRef<HTMLDivElement | null>(null);
  const adjustmentBalanceInputRef = useRef<HTMLInputElement | null>(null);

  const totalBalance = useMemo(
    () => getAssetBalance(accounts),
    [accounts]
  );
  const selectedAdjustmentAccount = useMemo(
    () => accounts.find((account) => account.id === adjustmentForm.accountId) ?? null,
    [accounts, adjustmentForm.accountId]
  );

  async function loadData(showLoader = true, force = false) {
    if (showLoader && accounts.length === 0 && transfers.length === 0) {
      setLoading(true);
    }
    setMessage("");

    try {
      const [accountData, nextTransfers] = await Promise.all([
        fetchAccounts({ withCounts: true, force }),
        fetchJsonCached<Transfer[]>(transfersCacheKey, "/api/transfers", {
          force,
          ttlMs: 12_000
        })
      ]);

      const nextAccounts = accountData.accounts;
      setAccounts(nextAccounts);
      setTransfers(nextTransfers);
      setTransferForm((current) => ({
        ...createTransferForm(nextAccounts),
        ...current,
        fromAccountId: nextAccounts.some((account) => account.id === current.fromAccountId)
          ? current.fromAccountId
          : nextAccounts[0]?.id ?? "",
        toAccountId: nextAccounts.some((account) => account.id === current.toAccountId)
          ? current.toAccountId
          : nextAccounts[1]?.id ?? nextAccounts[0]?.id ?? ""
      }));
      setAdjustmentForm((current) => ({
        ...createAdjustmentFormForAccount(
          nextAccounts.find((account) => account.id === current.accountId) ?? nextAccounts[0]
        ),
        description: current.description
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить счета");
      setMessageTone("error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function resetForm() {
    setForm(initialAccountForm);
    setEditingId(null);
    setErrors({});
  }

  function editAccount(account: Account) {
    setEditingId(account.id);
    setForm({
      name: account.name,
      type: account.type ?? "DEBIT",
      balance: String(account.balance),
      currency: account.currency,
      creditLimit: account.creditLimit ? String(account.creditLimit) : "",
      currentDebt: String(account.currentDebt ?? 0),
      availableCredit: String(account.availableCredit ?? 0),
      minimalPayment: account.minimalPayment ? String(account.minimalPayment) : "",
      paymentDate: account.paymentDate ? toDateInputValue(new Date(account.paymentDate)) : "",
      interestRate: account.interestRate !== null ? String(account.interestRate) : ""
    });
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const nextErrors: FormErrors = {};
    const balance = parseAmount(form.balance);
    const creditLimit = parseOptionalAmount(form.creditLimit);
    const currentDebt = parseAmount(form.currentDebt);
    const availableCredit = parseAmount(form.availableCredit);
    const minimalPayment = parseOptionalAmount(form.minimalPayment);
    const interestRate = parseOptionalAmount(form.interestRate);

    if (form.name.trim().length < 2) {
      nextErrors.name = "Название должно быть не короче 2 символов";
    }

    if (form.type === "DEBIT" && !Number.isFinite(balance)) {
      nextErrors.balance = "Введите корректный баланс";
    }

    if (form.type === "CREDIT_CARD") {
      if (!Number.isFinite(creditLimit) || creditLimit === null || creditLimit <= 0) {
        nextErrors.creditLimit = "Укажите кредитный лимит";
      }

      if (!Number.isFinite(currentDebt) || currentDebt < 0) {
        nextErrors.currentDebt = "Введите корректный текущий долг";
      }

      if (!Number.isFinite(availableCredit) || availableCredit < 0) {
        nextErrors.availableCredit = "Введите доступно сейчас";
      }

      if (minimalPayment !== null && (!Number.isFinite(minimalPayment) || minimalPayment < 0)) {
        nextErrors.minimalPayment = "Введите корректный платеж";
      }

      if (interestRate !== null && (!Number.isFinite(interestRate) || interestRate < 0)) {
        nextErrors.interestRate = "Введите корректный процент";
      }
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setMessage("Проверьте поля формы");
      setMessageTone("error");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(editingId ? `/api/accounts/${editingId}` : "/api/accounts", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          balance: form.type === "DEBIT" ? balance : 0,
          currency: form.currency,
          creditLimit,
          currentDebt: form.type === "CREDIT_CARD" ? currentDebt : 0,
          availableCredit: form.type === "CREDIT_CARD" ? availableCredit : 0,
          minimalPayment,
          paymentDate: form.type === "CREDIT_CARD" && form.paymentDate ? form.paymentDate : null,
          interestRate
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      invalidateFinancialDataCache();
      await loadData(false, true);
      resetForm();
      setMessage(editingId ? "Счет обновлен" : "Счет создан");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить счет");
      setMessageTone("error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteAccount(account: Account) {
    const sameTypeTarget =
      accounts.find((item) => item.id !== account.id && item.type === account.type) ?? null;

    if (getLinkedDataCount(account) > 0 || accounts.length <= 1) {
      setDeleteFlow({
        account,
        step: "choices",
        targetAccountId: sameTypeTarget?.id ?? "",
        confirmText: "",
        saving: false,
        error: ""
      });
      setMessage("");
      return;
    }

    const confirmed = window.confirm(`Удалить счет «${account.name}»?`);

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/accounts/${account.id}`, { method: "DELETE" });

      if (!response.ok) {
        const errorMessage = await readErrorMessage(response);

        if (response.status === 409) {
          setDeleteFlow({
            account,
            step: "choices",
            targetAccountId: sameTypeTarget?.id ?? "",
            confirmText: "",
            saving: false,
            error: errorMessage
          });
          return;
        }

        throw new Error(errorMessage);
      }

      invalidateFinancialDataCache();
      await loadData(false, true);
      setMessage("Счет удален");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось удалить счет");
      setMessageTone("error");
    }
  }

  async function moveDataAndDeleteAccount() {
    if (!deleteFlow) {
      return;
    }

    setDeleteFlow((current) =>
      current ? { ...current, saving: true, error: "" } : current
    );

    try {
      const response = await fetch(`/api/accounts/${deleteFlow.account.id}/delete-options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "MOVE_DATA",
          targetAccountId: deleteFlow.targetAccountId,
          confirmLastAccount: accounts.length <= 1
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      invalidateFinancialDataCache();
      await loadData(false, true);
      setDeleteFlow(null);
      setMessage("Данные перенесены, счет удален");
      setMessageTone("success");
      window.dispatchEvent(new Event("finance-data-changed"));
    } catch (error) {
      setDeleteFlow((current) =>
        current
          ? {
              ...current,
              saving: false,
              error: error instanceof Error ? error.message : "Не удалось перенести данные"
            }
          : current
      );
    }
  }

  async function deleteAccountWithData() {
    if (!deleteFlow) {
      return;
    }

    if (deleteFlow.confirmText !== "УДАЛИТЬ") {
      setDeleteFlow((current) =>
        current ? { ...current, error: "Введите УДАЛИТЬ для подтверждения" } : current
      );
      return;
    }

    setDeleteFlow((current) =>
      current ? { ...current, saving: true, error: "" } : current
    );

    try {
      const response = await fetch(`/api/accounts/${deleteFlow.account.id}/delete-options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "DELETE_WITH_DATA",
          confirm: true,
          confirmLastAccount: accounts.length <= 1
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      invalidateFinancialDataCache();
      await loadData(false, true);
      setDeleteFlow(null);
      setMessage("Счет и связанные операции удалены");
      setMessageTone("success");
      window.dispatchEvent(new Event("finance-data-changed"));
    } catch (error) {
      setDeleteFlow((current) =>
        current
          ? {
              ...current,
              saving: false,
              error: error instanceof Error ? error.message : "Не удалось удалить данные"
            }
          : current
      );
    }
  }

  async function saveTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = parseAmount(transferForm.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Введите сумму перевода больше нуля");
      setMessageTone("error");
      return;
    }

    try {
      const response = await fetch("/api/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...transferForm,
          amount
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      invalidateFinancialDataCache();
      await loadData(false, true);
      setTransferForm(createTransferForm(accounts));
      setMessage("Перевод выполнен");
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось выполнить перевод");
      setMessageTone("error");
    }
  }

  async function deleteTransfer(transfer: Transfer) {
    const confirmed = window.confirm("Удалить перевод? Балансы счетов будут пересчитаны.");

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/transfers/${transfer.id}`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      invalidateFinancialDataCache();
      await loadData(false, true);
      setMessage("Перевод удален");
      setMessageTone("success");
      window.dispatchEvent(new Event("finance-data-changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось удалить перевод");
      setMessageTone("error");
    }
  }

  async function adjustBalance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isCreditCard = selectedAdjustmentAccount?.type === "CREDIT_CARD";
    const balance = parseAmount(adjustmentForm.balance);
    const creditLimit = parseOptionalAmount(adjustmentForm.creditLimit);
    const currentDebt = parseAmount(adjustmentForm.currentDebt);
    const availableCredit = parseAmount(adjustmentForm.availableCredit);
    const minimalPayment = parseOptionalAmount(adjustmentForm.minimalPayment);
    const interestRate = parseOptionalAmount(adjustmentForm.interestRate);

    if (!adjustmentForm.accountId) {
      setMessage("Выберите счет");
      setMessageTone("error");
      return;
    }

    if (!isCreditCard && !Number.isFinite(balance)) {
      setMessage("Выберите счет и укажите новый баланс");
      setMessageTone("error");
      return;
    }

    if (
      isCreditCard &&
      (
        creditLimit === null ||
        !Number.isFinite(creditLimit) ||
        creditLimit <= 0 ||
        !Number.isFinite(currentDebt) ||
        currentDebt < 0 ||
        !Number.isFinite(availableCredit) ||
        availableCredit < 0 ||
        (minimalPayment !== null && (!Number.isFinite(minimalPayment) || minimalPayment < 0)) ||
        (interestRate !== null && (!Number.isFinite(interestRate) || interestRate < 0))
      )
    ) {
      setMessage("Проверьте поля кредитной карты");
      setMessageTone("error");
      return;
    }

    try {
      setAdjusting(true);
      const response = await fetch(`/api/accounts/${adjustmentForm.accountId}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isCreditCard
            ? {
                creditLimit,
                currentDebt,
                availableCredit,
                minimalPayment,
                paymentDate: adjustmentForm.paymentDate || null,
                interestRate
              }
            : {
                balance,
                date: adjustmentForm.date,
                description: adjustmentForm.description
              }
        )
      });

      if (!response.ok) {
        const errorMessage = await readErrorMessage(response);
        console.error("Balance adjustment failed", {
          status: response.status,
          message: errorMessage
        });
        throw new Error(errorMessage);
      }

      invalidateFinancialDataCache();
      await loadData(false, true);
      setAdjustmentForm(createAdjustmentForm([]));
      setActiveAdjustmentAccountId("");
      setMessage(isCreditCard ? "Кредитная карта обновлена" : "Баланс скорректирован");
      setMessageTone("success");
      window.dispatchEvent(new Event("finance-data-changed"));
    } catch (error) {
      console.error("Balance adjustment request error", error);
      setMessage(error instanceof Error ? error.message : "Не удалось скорректировать баланс");
      setMessageTone("error");
    } finally {
      setAdjusting(false);
    }
  }

  function startAdjustment(account: Account) {
    setActiveAdjustmentAccountId(account.id);
    setAdjustmentForm((current) => ({
      ...createAdjustmentFormForAccount(account),
      description: current.description
    }));
    setMessage(
      account.type === "CREDIT_CARD"
        ? `Обновите данные кредитной карты «${account.name}»`
        : `Введите желаемый баланс для счета «${account.name}»`
    );
    setMessageTone("neutral");

    window.requestAnimationFrame(() => {
      adjustmentSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      window.setTimeout(() => {
        adjustmentBalanceInputRef.current?.focus();
        adjustmentBalanceInputRef.current?.select();
      }, 250);
    });
  }

  const deleteTargetAccounts = deleteFlow
    ? accounts.filter(
        (account) =>
          account.id !== deleteFlow.account.id && account.type === deleteFlow.account.type
      )
    : [];
  const deleteFlowLinkedCount = deleteFlow ? getLinkedDataCount(deleteFlow.account) : 0;
  const deleteFlowTransferCount = deleteFlow ? getTransferCount(deleteFlow.account) : 0;
  const deleteFlowHasLinkedDebt = (deleteFlow?.account._count?.linkedLoans ?? 0) > 0;
  const canMoveDeleteFlow = deleteTargetAccounts.length > 0;
  const canDestroyDeleteFlow =
    !!deleteFlow && deleteFlow.confirmText === "УДАЛИТЬ" && !deleteFlowHasLinkedDebt;

  return (
    <div>
      <PageHeader title="Счета" description="Баланс по счетам, наличным и картам." />

      {deleteFlow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
          <div className="w-full max-w-lg rounded-md border border-line bg-paper p-5 shadow-soft">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-ink">
                  У этого счета есть операции, переводы или долги. Что сделать?
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Счет: {deleteFlow.account.name}
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary h-9 w-9 min-h-0 p-0"
                onClick={() => setDeleteFlow(null)}
                aria-label="Закрыть"
                title="Закрыть"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 rounded-md border border-line bg-soft/30 px-3 py-3 text-sm text-muted">
              Операций: {deleteFlow.account._count?.transactions ?? 0} · Переводов:{" "}
              {deleteFlowTransferCount} · Долгов: {deleteFlow.account._count?.linkedLoans ?? 0}
              {accounts.length <= 1 ? " · Последний счет" : ""}
            </div>

            {deleteFlow.error ? (
              <div className="mt-4 rounded-md border border-loss/30 bg-loss/10 px-3 py-2 text-sm text-loss">
                {deleteFlow.error}
              </div>
            ) : null}

            {deleteFlow.step === "choices" ? (
              <div className="mt-5 space-y-3">
                <button
                  type="button"
                  className="btn-secondary w-full justify-start"
                  disabled={!canMoveDeleteFlow || deleteFlow.saving}
                  onClick={() =>
                    setDeleteFlow((current) =>
                      current
                        ? {
                            ...current,
                            step: "move",
                            targetAccountId:
                              deleteTargetAccounts[0]?.id ?? current.targetAccountId,
                            error: ""
                          }
                        : current
                    )
                  }
                >
                  Перенести данные на другой счет
                </button>
                {!canMoveDeleteFlow ? (
                  <p className="text-sm text-muted">
                    Нет другого счета того же типа для переноса.
                  </p>
                ) : null}

                <button
                  type="button"
                  className="btn-danger w-full justify-start"
                  disabled={deleteFlow.saving}
                  onClick={() =>
                    setDeleteFlow((current) =>
                      current
                        ? {
                            ...current,
                            step: "destroy",
                            confirmText: "",
                            error: ""
                          }
                        : current
                    )
                  }
                >
                  Удалить счет и связанные операции
                </button>
                {deleteFlowHasLinkedDebt ? (
                  <p className="text-sm text-muted">
                    У счета есть связанный долг. Долг не будет удален молча: перенесите данные
                    на другой счет или отвяжите долг перед удалением.
                  </p>
                ) : null}

                <button
                  type="button"
                  className="btn-secondary w-full"
                  disabled={deleteFlow.saving}
                  onClick={() => setDeleteFlow(null)}
                >
                  Отмена
                </button>
              </div>
            ) : null}

            {deleteFlow.step === "move" ? (
              <div className="mt-5 space-y-4">
                <div>
                  <label className="field-label" htmlFor="deleteTargetAccountId">
                    Куда перенести данные
                  </label>
                  <select
                    id="deleteTargetAccountId"
                    className="field mt-1"
                    value={deleteFlow.targetAccountId}
                    onChange={(event) =>
                      setDeleteFlow((current) =>
                        current
                          ? { ...current, targetAccountId: event.target.value, error: "" }
                          : current
                      )
                    }
                    disabled={deleteFlow.saving}
                  >
                    {deleteTargetAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-sm text-muted">
                    Операции и связанные долги будут перенесены. Переводы с этим счетом будут
                    переназначены, а внутренние переводы между двумя объединяемыми счетами удалены.
                  </p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    className="btn-primary flex-1"
                    disabled={!deleteFlow.targetAccountId || deleteFlow.saving}
                    onClick={moveDataAndDeleteAccount}
                  >
                    {deleteFlow.saving ? "Перенос" : "Перенести и удалить"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary flex-1"
                    disabled={deleteFlow.saving}
                    onClick={() =>
                      setDeleteFlow((current) =>
                        current ? { ...current, step: "choices", error: "" } : current
                      )
                    }
                  >
                    Назад
                  </button>
                </div>
              </div>
            ) : null}

            {deleteFlow.step === "destroy" ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-md border border-loss/30 bg-loss/10 px-3 py-3 text-sm text-loss">
                  Это удалит счет, операции и связанные данные. Действие нельзя отменить.
                </div>

                {deleteFlowHasLinkedDebt ? (
                  <div className="rounded-md border border-line bg-soft/30 px-3 py-3 text-sm text-muted">
                    У счета есть связанный долг. Для безопасности сначала перенесите данные на
                    другой счет или отвяжите долг.
                  </div>
                ) : null}

                <div>
                  <label className="field-label" htmlFor="deleteConfirmText">
                    Введите УДАЛИТЬ
                  </label>
                  <input
                    id="deleteConfirmText"
                    className="field mt-1"
                    value={deleteFlow.confirmText}
                    onChange={(event) =>
                      setDeleteFlow((current) =>
                        current
                          ? { ...current, confirmText: event.target.value, error: "" }
                          : current
                      )
                    }
                    disabled={deleteFlow.saving || deleteFlowHasLinkedDebt}
                    autoComplete="off"
                  />
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    className="btn-danger flex-1"
                    disabled={!canDestroyDeleteFlow || deleteFlow.saving}
                    onClick={deleteAccountWithData}
                  >
                    {deleteFlow.saving ? "Удаление" : "Удалить счет и данные"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary flex-1"
                    disabled={deleteFlow.saving}
                    onClick={() =>
                      setDeleteFlow((current) =>
                        current ? { ...current, step: "choices", error: "" } : current
                      )
                    }
                  >
                    Назад
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <StatCard
          label="Деньги на счетах"
          value={formatCurrency(totalBalance)}
          icon={ArrowRightLeft}
          tone={totalBalance >= 0 ? "income" : "expense"}
        />
        <StatCard
          label="Счетов"
          value={String(accounts.length)}
          icon={Check}
          tone="neutral"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <section className="space-y-6">
          <div className="card p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-ink">
                {editingId ? "Редактирование счета" : "Новый счет"}
              </h2>
              {editingId ? (
                <button type="button" className="btn-secondary" onClick={resetForm}>
                  <X className="h-4 w-4" aria-hidden="true" />
                  Отмена
                </button>
              ) : null}
            </div>

            <form className="space-y-4" onSubmit={saveAccount}>
              <div>
                <label className="field-label" htmlFor="accountName">
                  Название
                </label>
                <input
                  id="accountName"
                  className="field mt-1"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Например, Tinkoff, Наличные"
                />
                <FieldError message={errors.name} />
              </div>

              <div>
                <label className="field-label" htmlFor="accountType">
                  Тип счета
                </label>
                <select
                  id="accountType"
                  className="field mt-1"
                  disabled={Boolean(editingId)}
                  value={form.type}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      type: event.target.value as AccountType
                    }))
                  }
                >
                  <option value="DEBIT">Обычный счет</option>
                  <option value="CREDIT_CARD">Кредитная карта</option>
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {form.type === "DEBIT" ? (
                  <div>
                    <label className="field-label" htmlFor="accountBalance">
                      Начальный баланс
                    </label>
                    <input
                      id="accountBalance"
                      className="field mt-1"
                      disabled={Boolean(editingId)}
                      inputMode="decimal"
                      value={form.balance}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, balance: event.target.value }))
                      }
                      placeholder="0"
                    />
                    <p className="mt-1 text-xs text-muted">
                      Баланс рассчитывается из операций.
                    </p>
                    <FieldError message={errors.balance} />
                  </div>
                ) : (
                  <div>
                    <label className="field-label" htmlFor="creditLimit">
                      Кредитный лимит
                    </label>
                    <input
                      id="creditLimit"
                      className="field mt-1"
                      inputMode="decimal"
                      value={form.creditLimit}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, creditLimit: event.target.value }))
                      }
                      placeholder="100000"
                    />
                    <FieldError message={errors.creditLimit} />
                  </div>
                )}

                <div>
                  <label className="field-label" htmlFor="accountCurrency">
                    Валюта
                  </label>
                  <select
                    id="accountCurrency"
                    className="field mt-1"
                    value={form.currency}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        currency: event.target.value as CurrencyCode
                      }))
                    }
                  >
                    <option value="RUB">RUB</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
              </div>

              {form.type === "CREDIT_CARD" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="field-label" htmlFor="currentDebt">
                      Текущая задолженность
                    </label>
                    <input
                      id="currentDebt"
                      className="field mt-1"
                      disabled={Boolean(editingId)}
                      inputMode="decimal"
                      value={form.currentDebt}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, currentDebt: event.target.value }))
                      }
                      placeholder="0"
                    />
                    <p className="mt-1 text-xs text-muted">
                      После создания меняется через корректировку кредитной карты.
                    </p>
                    <FieldError message={errors.currentDebt} />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="availableCredit">
                      Доступно сейчас
                    </label>
                    <input
                      id="availableCredit"
                      className="field mt-1"
                      disabled={Boolean(editingId)}
                      inputMode="decimal"
                      value={form.availableCredit}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          availableCredit: event.target.value
                        }))
                      }
                      placeholder="0"
                    />
                    <p className="mt-1 text-xs text-muted">
                      Это отдельное значение из банка, не формула лимит минус долг.
                    </p>
                    <FieldError message={errors.availableCredit} />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="minimalPayment">
                      Минимальный платеж
                    </label>
                    <input
                      id="minimalPayment"
                      className="field mt-1"
                      inputMode="decimal"
                      value={form.minimalPayment}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          minimalPayment: event.target.value
                        }))
                      }
                      placeholder="Необязательно"
                    />
                    <FieldError message={errors.minimalPayment} />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="cardInterestRate">
                      Процент
                    </label>
                    <input
                      id="cardInterestRate"
                      className="field mt-1"
                      inputMode="decimal"
                      value={form.interestRate}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          interestRate: event.target.value
                        }))
                      }
                      placeholder="Необязательно"
                    />
                    <FieldError message={errors.interestRate} />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="field-label" htmlFor="cardPaymentDate">
                      Оплатить до
                    </label>
                    <input
                      id="cardPaymentDate"
                      className="field mt-1"
                      type="date"
                      value={form.paymentDate}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          paymentDate: event.target.value
                        }))
                      }
                    />
                  </div>
                </div>
              ) : null}

              <Notice message={message} tone={messageTone} />

              <button type="submit" className="btn-primary w-full" disabled={saving}>
                {editingId ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {saving ? "Сохранение" : editingId ? "Сохранить" : "Создать счет"}
              </button>
            </form>
          </div>

          <div className="card p-4 sm:p-5">
            <h2 className="mb-4 text-lg font-semibold text-ink">Перевод между счетами</h2>
            <form className="space-y-4" onSubmit={saveTransfer}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="fromAccount">
                    Откуда
                  </label>
                  <select
                    id="fromAccount"
                    className="field mt-1"
                    value={transferForm.fromAccountId}
                    onChange={(event) =>
                      setTransferForm((current) => ({
                        ...current,
                        fromAccountId: event.target.value
                      }))
                    }
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="toAccount">
                    Куда
                  </label>
                  <select
                    id="toAccount"
                    className="field mt-1"
                    value={transferForm.toAccountId}
                    onChange={(event) =>
                      setTransferForm((current) => ({
                        ...current,
                        toAccountId: event.target.value
                      }))
                    }
                  >
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="transferAmount">
                    Сумма
                  </label>
                  <input
                    id="transferAmount"
                    className="field mt-1"
                    inputMode="decimal"
                    value={transferForm.amount}
                    onChange={(event) =>
                      setTransferForm((current) => ({ ...current, amount: event.target.value }))
                    }
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="transferDate">
                    Дата
                  </label>
                  <input
                    id="transferDate"
                    className="field mt-1"
                    type="date"
                    value={transferForm.date}
                    onChange={(event) =>
                      setTransferForm((current) => ({ ...current, date: event.target.value }))
                    }
                  />
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor="transferDescription">
                  Комментарий
                </label>
                <input
                  id="transferDescription"
                  className="field mt-1"
                  value={transferForm.description}
                  onChange={(event) =>
                    setTransferForm((current) => ({
                      ...current,
                      description: event.target.value
                    }))
                  }
                  placeholder="Необязательно"
                />
              </div>
              <button type="submit" className="btn-secondary w-full" disabled={accounts.length < 2}>
                Перевести
              </button>
            </form>
          </div>

          <div
            ref={adjustmentSectionRef}
            className={`card p-4 transition sm:p-5 ${
              activeAdjustmentAccountId ? "ring-2 ring-accent/30" : ""
            }`}
          >
            <h2 className="mb-4 text-lg font-semibold text-ink">
              {selectedAdjustmentAccount?.type === "CREDIT_CARD"
                ? "Корректировка кредитной карты"
                : "Корректировка баланса"}
            </h2>
            <Notice message={message} tone={messageTone} />
            <form className="space-y-4" onSubmit={adjustBalance}>
              <div>
                <label className="field-label" htmlFor="adjustAccount">
                  Счет
                </label>
                <select
                  id="adjustAccount"
                  className="field mt-1"
                  value={adjustmentForm.accountId}
                  onChange={(event) => {
                    const account = accounts.find((item) => item.id === event.target.value);
                    setAdjustmentForm((current) => ({
                      ...createAdjustmentFormForAccount(account),
                      description: current.description
                    }));
                  }}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.type === "CREDIT_CARD"
                        ? `${account.name} · доступно ${formatCurrency(
                            account.availableCredit,
                            account.currency
                          )} · долг ${formatCurrency(account.currentDebt, account.currency)}`
                        : `${account.name} · ${formatCurrency(account.balance, account.currency)}`}
                    </option>
                  ))}
                </select>
              </div>
              {selectedAdjustmentAccount?.type === "CREDIT_CARD" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="field-label" htmlFor="adjustCreditLimit">
                      Кредитный лимит
                    </label>
                    <input
                      id="adjustCreditLimit"
                      className="field mt-1"
                      inputMode="decimal"
                      value={adjustmentForm.creditLimit}
                      onChange={(event) =>
                        setAdjustmentForm((current) => ({
                          ...current,
                          creditLimit: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="adjustCurrentDebt">
                      Текущая задолженность
                    </label>
                    <input
                      id="adjustCurrentDebt"
                      ref={adjustmentBalanceInputRef}
                      className="field mt-1"
                      inputMode="decimal"
                      value={adjustmentForm.currentDebt}
                      onChange={(event) =>
                        setAdjustmentForm((current) => ({
                          ...current,
                          currentDebt: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="adjustAvailableCredit">
                      Доступно сейчас
                    </label>
                    <input
                      id="adjustAvailableCredit"
                      className="field mt-1"
                      inputMode="decimal"
                      value={adjustmentForm.availableCredit}
                      onChange={(event) =>
                        setAdjustmentForm((current) => ({
                          ...current,
                          availableCredit: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="adjustMinimalPayment">
                      Минимальный платеж
                    </label>
                    <input
                      id="adjustMinimalPayment"
                      className="field mt-1"
                      inputMode="decimal"
                      value={adjustmentForm.minimalPayment}
                      onChange={(event) =>
                        setAdjustmentForm((current) => ({
                          ...current,
                          minimalPayment: event.target.value
                        }))
                      }
                      placeholder="Необязательно"
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="adjustPaymentDate">
                      Дата платежа
                    </label>
                    <input
                      id="adjustPaymentDate"
                      className="field mt-1"
                      type="date"
                      value={adjustmentForm.paymentDate}
                      onChange={(event) =>
                        setAdjustmentForm((current) => ({
                          ...current,
                          paymentDate: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="adjustInterestRate">
                      Процент
                    </label>
                    <input
                      id="adjustInterestRate"
                      className="field mt-1"
                      inputMode="decimal"
                      value={adjustmentForm.interestRate}
                      onChange={(event) =>
                        setAdjustmentForm((current) => ({
                          ...current,
                          interestRate: event.target.value
                        }))
                      }
                      placeholder="Необязательно"
                    />
                  </div>
                  <p className="text-xs text-muted sm:col-span-2">
                    Эти значения берутся из банка. Доступно сейчас не считается из лимита и долга.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="field-label" htmlFor="adjustBalance">
                        Желаемый баланс
                      </label>
                      <input
                        id="adjustBalance"
                        ref={adjustmentBalanceInputRef}
                        className="field mt-1"
                        inputMode="decimal"
                        value={adjustmentForm.balance}
                        onChange={(event) =>
                          setAdjustmentForm((current) => ({
                            ...current,
                            balance: event.target.value
                          }))
                        }
                        placeholder="0"
                      />
                      {selectedAdjustmentAccount ? (
                        <p className="mt-1 text-xs text-muted">
                          Сейчас:{" "}
                          {formatCurrency(
                            selectedAdjustmentAccount.balance,
                            selectedAdjustmentAccount.currency
                          )}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <label className="field-label" htmlFor="adjustDate">
                        Дата
                      </label>
                      <input
                        id="adjustDate"
                        className="field mt-1"
                        type="date"
                        value={adjustmentForm.date}
                        onChange={(event) =>
                          setAdjustmentForm((current) => ({
                            ...current,
                            date: event.target.value
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="adjustDescription">
                      Комментарий
                    </label>
                    <input
                      id="adjustDescription"
                      className="field mt-1"
                      value={adjustmentForm.description}
                      onChange={(event) =>
                        setAdjustmentForm((current) => ({
                          ...current,
                          description: event.target.value
                        }))
                      }
                      placeholder="Например, сверка с банком"
                    />
                  </div>
                  <p className="text-xs text-muted">
                    Баланс рассчитывается из операций. Корректировка создаст отдельную операцию на
                    разницу.
                  </p>
                </>
              )}
              <button type="submit" className="btn-secondary w-full" disabled={adjusting}>
                {adjusting
                  ? "Сохранение"
                  : selectedAdjustmentAccount?.type === "CREDIT_CARD"
                    ? "Сохранить данные карты"
                    : "Создать корректировку"}
              </button>
            </form>
          </div>
        </section>

        <section className="min-w-0 space-y-4">
          {loading && accounts.length > 0 ? (
            <p className="text-sm text-muted">Обновляем данные…</p>
          ) : null}

          {loading && accounts.length === 0 ? (
            <>
              <p className="text-sm text-muted">Загрузка...</p>
              <div className="grid gap-4">
                <StatCard label="Общий баланс" value="" icon={ArrowRightLeft} loading />
                <div className="card p-4 sm:p-5">
                  <div className="space-y-3">
                    <div className="h-3 w-2/3 animate-pulse rounded-md bg-soft/50" />
                    <div className="h-3 w-1/2 animate-pulse rounded-md bg-soft/40" />
                    <div className="h-3 w-3/4 animate-pulse rounded-md bg-soft/40" />
                  </div>
                </div>
              </div>
            </>
          ) : accounts.length === 0 ? (
            <EmptyState text="Счетов пока нет" />
          ) : (
            <div className="grid gap-4">
              {accounts.map((account) => {
                const availableLimit = getAvailableLimit(account);
                const overLimit = getOverLimit(account);

                return (
                <article key={account.id} className="card p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-ink">{account.name}</h2>
                      <div className="mt-1 text-sm text-muted">
                        {account.type === "CREDIT_CARD" ? "Кредитная карта" : "Обычный счет"} ·{" "}
                        {account.currency}
                      </div>
                      {account.type === "CREDIT_CARD" ? (
                        <div className="mt-4 rounded-md border border-line bg-soft/30 px-3 py-3">
                          <div className="text-xs font-medium uppercase tracking-normal text-muted">
                            Доступно сейчас
                          </div>
                          <div className="mt-1 text-2xl font-semibold text-ink">
                            {formatCurrency(availableLimit, account.currency)}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 text-2xl font-semibold text-ink">
                          {formatCurrency(account.balance, account.currency)}
                        </div>
                      )}
                      {account.type === "CREDIT_CARD" ? (
                        <div className="mt-3 grid gap-1 text-sm text-muted">
                          <div>
                            Кредитный лимит:{" "}
                            {formatCurrency(account.creditLimit ?? 0, account.currency)}
                          </div>
                          <div>
                            Текущая задолженность:{" "}
                            {formatCurrency(account.currentDebt ?? 0, account.currency)}
                          </div>
                          {overLimit > 0 ? (
                            <div className="text-loss">
                              Превышение лимита: {formatCurrency(overLimit, account.currency)}
                            </div>
                          ) : null}
                          {account.minimalPayment ? (
                            <div>
                              Минимальный платеж:{" "}
                              {formatCurrency(account.minimalPayment, account.currency)}
                            </div>
                          ) : null}
                          {account.interestRate !== null ? (
                            <div>Процент: {account.interestRate}%</div>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="mt-3 text-sm text-muted">
                        Операций: {account._count?.transactions ?? 0}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-secondary px-2"
                        onClick={() => startAdjustment(account)}
                      >
                        Корректировать
                      </button>
                      <button
                        type="button"
                        className="btn-secondary px-2"
                        onClick={() => editAccount(account)}
                        aria-label="Редактировать счет"
                        title="Редактировать"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="btn-danger px-2"
                        onClick={() => deleteAccount(account)}
                        aria-label="Удалить счет"
                        title="Удалить"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </article>
              );
              })}
            </div>
          )}

          <section className="card p-4 sm:p-5">
            <h2 className="mb-4 text-lg font-semibold text-ink">Последние переводы</h2>
            {transfers.length === 0 ? (
              <EmptyState text="Переводов пока нет" />
            ) : (
              <div className="divide-y divide-line overflow-hidden rounded-md border border-line">
                {transfers.map((transfer) => (
                  <div key={transfer.id} className="px-3 py-3 text-sm hover:bg-hover">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-ink">
                          {transfer.fromAccount?.name} {"->"} {transfer.toAccount?.name}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {formatDate(transfer.date)}
                          {transfer.description ? ` · ${transfer.description}` : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <div className="font-semibold text-ink">
                          {formatCurrency(transfer.amount)}
                        </div>
                        <button
                          type="button"
                          className="btn-danger px-2"
                          onClick={() => deleteTransfer(transfer)}
                          aria-label="Удалить перевод"
                          title="Удалить"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>
      </div>
    </div>
  );
}
