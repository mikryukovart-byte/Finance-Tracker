export function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-paper/40 px-4 py-8 text-center text-sm text-muted">
      {text}
    </div>
  );
}
