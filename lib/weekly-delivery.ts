export type WeeklyDeliveryValue = {
  enabled: boolean;
  timezone: string;
  weekday: number;
  localTime: string;
  updatedAt: string | null;
};

export const defaultWeeklyDelivery: WeeklyDeliveryValue = {
  enabled: false,
  timezone: "",
  weekday: 1,
  localTime: "09:00",
  updatedAt: null
};

function zonedParts(now: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(now);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
  } catch {
    return null;
  }
}

const weekdayNumber: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
};

export function weeklyDeliveryWindow(
  settings: Pick<WeeklyDeliveryValue, "enabled" | "timezone" | "weekday" | "localTime">,
  now = new Date(),
  windowMinutes = 59
) {
  if (!settings.enabled || !settings.timezone) return null;
  const parts = zonedParts(now, settings.timezone);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(settings.localTime);
  if (!parts || !timeMatch || weekdayNumber[parts.weekday] !== settings.weekday) return null;

  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const targetMinutes = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
  if (currentMinutes < targetMinutes || currentMinutes > targetMinutes + windowMinutes) return null;

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function splitTelegramMessage(text: string, maximum = 3900) {
  if (text.length <= maximum) return [text];
  const parts: string[] = [];
  let current = "";

  for (const paragraph of text.split(/\n\n+/)) {
    if (paragraph.length > maximum) {
      if (current) {
        parts.push(current);
        current = "";
      }
      let rest = paragraph;
      while (rest.length > maximum) {
        let cut = rest.lastIndexOf(" ", maximum);
        if (cut < maximum * 0.6) cut = maximum;
        parts.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      current = rest;
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maximum) {
      parts.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts.filter(Boolean);
}
