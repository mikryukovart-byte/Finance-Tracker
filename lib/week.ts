export function parseDateOnly(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function dateOnlyValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

export function mondayOfWeek(date: Date) {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset, 12);
}

export function normalizeWeekStart(value?: string, fallback = new Date()) {
  return dateOnlyValue(mondayOfWeek(parseDateOnly(value) ?? fallback));
}

export function shiftWeekStart(weekStart: string, weeks: number) {
  const date = parseDateOnly(weekStart) ?? mondayOfWeek(new Date());
  return dateOnlyValue(
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + weeks * 7, 12)
  );
}

export function weekEndDate(weekStart: string) {
  const date = parseDateOnly(weekStart) ?? mondayOfWeek(new Date());
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 6, 12);
}

export function defaultDateForWeek(weekStart: string, now = new Date()) {
  return normalizeWeekStart(undefined, now) === weekStart
    ? dateOnlyValue(now)
    : weekStart;
}
