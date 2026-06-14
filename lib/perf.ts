export function createApiTimer(route: string) {
  const enabled = process.env.NODE_ENV === "development";
  const startedAt = Date.now();
  const marks: Record<string, number> = {};

  return {
    mark(label: string, started: number) {
      if (enabled) {
        marks[label] = Date.now() - started;
      }
    },
    set(label: string, ms: number) {
      if (enabled) {
        marks[label] = ms;
      }
    },
    done(extra: Record<string, unknown> = {}) {
      if (!enabled) {
        return;
      }

      console.info("[perf]", route, {
        ...marks,
        total: Date.now() - startedAt,
        ...extra
      });
    }
  };
}
