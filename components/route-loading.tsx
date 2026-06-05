export function RouteLoading() {
  const labels = ["Баланс", "Доходы", "Расходы", "Долг"];

  return (
    <div className="space-y-6">
      <div>
        <div className="h-7 w-44 animate-pulse rounded-md bg-soft/60" />
        <div className="mt-3 h-3 w-full max-w-md animate-pulse rounded-md bg-soft/40" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {labels.map((label) => (
          <div key={label} className="card p-4 sm:p-5">
            <div className="text-sm text-muted">{label}</div>
            <div className="mt-2 text-2xl font-semibold text-muted">…</div>
          </div>
        ))}
      </div>

      <div className="card p-4 sm:p-5">
        <div className="space-y-3">
          <div className="h-3 w-3/4 animate-pulse rounded-md bg-soft/50" />
          <div className="h-3 w-2/3 animate-pulse rounded-md bg-soft/40" />
          <div className="h-3 w-5/6 animate-pulse rounded-md bg-soft/40" />
          <div className="h-3 w-1/2 animate-pulse rounded-md bg-soft/30" />
        </div>
      </div>
    </div>
  );
}
