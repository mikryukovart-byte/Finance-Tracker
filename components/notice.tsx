import { AlertCircle, CheckCircle2 } from "lucide-react";

export function Notice({
  message,
  tone = "neutral"
}: {
  message: string;
  tone?: "neutral" | "success" | "error";
}) {
  if (!message) {
    return null;
  }

  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  const className =
    tone === "error"
      ? "border-loss/30 bg-loss/10 text-loss"
      : tone === "success"
        ? "border-profit/30 bg-profit/10 text-profit"
        : "border-line bg-soft text-ink";

  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${className}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return <p className="mt-1 text-xs text-loss">{message}</p>;
}
