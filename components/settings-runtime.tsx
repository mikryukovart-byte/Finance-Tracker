"use client";

import { useEffect } from "react";

import { parseSettings, storageKey } from "@/lib/settings";

export function SettingsRuntime() {
  useEffect(() => {
    function applySettings() {
      const settings = parseSettings(window.localStorage.getItem(storageKey));
      document.documentElement.dataset.compactTables = String(settings.compactTables);
    }

    applySettings();
    window.addEventListener("storage", applySettings);
    window.addEventListener("finance-settings-changed", applySettings);

    return () => {
      window.removeEventListener("storage", applySettings);
      window.removeEventListener("finance-settings-changed", applySettings);
    };
  }, []);

  return null;
}
