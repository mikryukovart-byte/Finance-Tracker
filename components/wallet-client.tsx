"use client";

import { useCallback, useEffect, useState } from "react";

import { AccountsClient } from "@/components/accounts-client";
import { LoansClient } from "@/components/loans-client";
import { PageHeader } from "@/components/page-header";
import { fetchAccounts, fetchJsonCached } from "@/lib/client-api";
import { formatCurrency } from "@/lib/format";
import type { LoansResponse } from "@/types/finance";

type WalletSection = "accounts" | "credits";

type WalletMetrics = {
  ownMoney: number | null;
  totalDebt: number | null;
};

const loansCacheKey = "loans:list";

export function WalletClient() {
  const [activeSection, setActiveSection] = useState<WalletSection>("accounts");
  const [metrics, setMetrics] = useState<WalletMetrics>({
    ownMoney: null,
    totalDebt: null
  });

  const loadMetrics = useCallback(async (force = false) => {
    try {
      const [accountData, loanData] = await Promise.all([
        fetchAccounts({ force }),
        fetchJsonCached<LoansResponse>(loansCacheKey, "/api/loans", {
          force,
          ttlMs: 12_000
        })
      ]);

      setMetrics({
        ownMoney: accountData.totalBalance,
        totalDebt: loanData.summary.totalDebt
      });
    } catch {
      setMetrics((current) => current);
    }
  }, []);

  useEffect(() => {
    loadMetrics();

    function handleFinancialDataChanged() {
      loadMetrics(true);
    }

    window.addEventListener("finance-data-changed", handleFinancialDataChanged);

    return () => {
      window.removeEventListener("finance-data-changed", handleFinancialDataChanged);
    };
  }, [loadMetrics]);

  const sectionCards = [
    {
      id: "accounts" as const,
      title: "Счета",
      description: "Деньги на счетах, наличные и карты.",
      metric:
        metrics.ownMoney === null ? "…" : formatCurrency(metrics.ownMoney)
    },
    {
      id: "credits" as const,
      title: "Кредиты",
      description: "Кредитные карты, долги и обязательства.",
      metric:
        metrics.totalDebt === null ? "…" : formatCurrency(metrics.totalDebt)
    }
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Кошелёк"
        description="Счета, карты, переводы и долги в одном разделе."
      />

      <div className="grid gap-4 md:grid-cols-2">
        {sectionCards.map((section) => {
          const isActive = activeSection === section.id;

          return (
            <button
              key={section.id}
              type="button"
              className={`card min-h-[140px] p-5 text-left transition hover:bg-soft/40 ${
                isActive ? "border-line bg-soft/35" : "bg-paper"
              }`}
              onClick={() => setActiveSection(section.id)}
              aria-pressed={isActive}
            >
              <div className="flex h-full flex-col justify-between gap-5">
                <div>
                  <h2 className="text-xl font-semibold text-ink">{section.title}</h2>
                  <p className="mt-2 text-sm text-muted">{section.description}</p>
                </div>
                <div className="text-2xl font-semibold text-ink">{section.metric}</div>
              </div>
            </button>
          );
        })}
      </div>

      {activeSection === "accounts" ? <AccountsClient /> : <LoansClient />}
    </div>
  );
}
