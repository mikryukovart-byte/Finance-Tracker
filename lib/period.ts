export type PeriodPreset = "today" | "week" | "month" | "year" | "custom";

export type PeriodState = {
  preset: PeriodPreset;
  startDate: string;
  endDate: string;
};

export const periodLabels: Record<PeriodPreset, string> = {
  today: "Сегодня",
  week: "Неделя",
  month: "Месяц",
  year: "Год",
  custom: "Свой период"
};

function toDateInputValue(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + diff);
}

export function createPeriodState(preset: PeriodPreset = "month", now = new Date()): PeriodState {
  if (preset === "today") {
    return {
      preset,
      startDate: toDateInputValue(now),
      endDate: toDateInputValue(now)
    };
  }

  if (preset === "week") {
    const start = startOfWeek(now);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);

    return {
      preset,
      startDate: toDateInputValue(start),
      endDate: toDateInputValue(end)
    };
  }

  if (preset === "year") {
    return {
      preset,
      startDate: toDateInputValue(new Date(now.getFullYear(), 0, 1)),
      endDate: toDateInputValue(new Date(now.getFullYear(), 11, 31))
    };
  }

  return {
    preset,
    startDate: toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate: toDateInputValue(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  };
}

export function buildPeriodQuery(period: PeriodState) {
  return {
    startDate: period.startDate,
    endDate: period.endDate
  };
}

export function describePeriod(period: PeriodState) {
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const start = formatter.format(new Date(`${period.startDate}T12:00:00`));
  const end = formatter.format(new Date(`${period.endDate}T12:00:00`));

  return start === end ? start : `с ${start} по ${end}`;
}
