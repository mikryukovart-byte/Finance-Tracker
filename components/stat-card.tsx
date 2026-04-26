import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral"
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "neutral" | "income" | "expense";
}) {
  const toneClass =
    tone === "income"
      ? "bg-profit/10 text-profit"
      : tone === "expense"
        ? "bg-loss/10 text-loss"
        : "bg-soft text-muted";

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{label}</p>
          <p className="mt-2 break-words text-2xl font-semibold tracking-normal text-ink">
            {value}
          </p>
        </div>
        <div className={`rounded-md p-2 ${toneClass}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
