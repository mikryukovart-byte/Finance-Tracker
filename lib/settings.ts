export type SettingsState = {
  currency: "RUB";
  compactTables: boolean;
  monthlyLimit: string;
  leakageThreshold: string;
};

export const storageKey = "finance-tracker-settings";

export const defaultSettings: SettingsState = {
  currency: "RUB",
  compactTables: false,
  monthlyLimit: "",
  leakageThreshold: "1000"
};

export function parseSettings(value: string | null): SettingsState {
  if (!value) {
    return defaultSettings;
  }

  try {
    return { ...defaultSettings, ...JSON.parse(value) };
  } catch {
    return defaultSettings;
  }
}
