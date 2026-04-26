export function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function endOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

export function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

export function startOfYear(date = new Date()) {
  return new Date(date.getFullYear(), 0, 1);
}

export function endOfYear(date = new Date()) {
  return new Date(date.getFullYear() + 1, 0, 1);
}

export function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric"
  }).format(date);
}

export function parseDateInput(value: unknown) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);

  if (match) {
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

  const date = new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

export function dateRangeFromSearch(searchParams: URLSearchParams) {
  const from = parseDateInput(searchParams.get("dateFrom"));
  const to = parseDateInput(searchParams.get("dateTo"));

  return {
    from: from ? startOfDay(from) : undefined,
    to: to ? endOfDay(to) : undefined
  };
}
