export function RouteLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-48 animate-pulse rounded-md bg-soft/70" />
        <div className="mt-3 h-4 w-full max-w-md animate-pulse rounded-md bg-soft/50" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="card h-28 animate-pulse bg-soft/50" />
        ))}
      </div>

      <div className="card h-72 animate-pulse bg-soft/40" />
    </div>
  );
}
