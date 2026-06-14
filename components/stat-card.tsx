import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  loading = false,
  showIcon = true,
  description,
  valueNoWrap = false,
  valueSize = "normal"
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "neutral" | "income" | "expense";
  loading?: boolean;
  showIcon?: boolean;
  description?: string;
  valueNoWrap?: boolean;
  valueSize?: "normal" | "compact";
}) {
  const toneClass =
    tone === "income"
      ? "bg-profit/10 text-profit"
      : tone === "expense"
        ? "bg-loss/10 text-loss"
        : "bg-soft text-muted";
  const valueWrapClass = valueNoWrap ? "whitespace-nowrap" : "break-words";
  const valueSizeClass = valueSize === "compact" ? "text-xl sm:text-2xl" : "text-2xl";

  return (
    <div className="card p-4 sm:p-5" aria-busy={loading}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted">{label}</p>
          <p
            className={`mt-2 ${valueWrapClass} ${valueSizeClass} font-semibold tracking-normal ${
              loading ? "text-muted" : "text-ink"
            }`}
          >
            {loading ? "…" : value}
          </p>
          {description ? (
            <p className="mt-1 text-xs text-muted">{description}</p>
          ) : null}
        </div>
        {showIcon ? (
          <div className={`shrink-0 rounded-md p-2 ${toneClass}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
