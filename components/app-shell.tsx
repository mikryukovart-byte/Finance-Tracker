"use client";

import { Sidebar } from "@/components/sidebar";
import { SettingsRuntime } from "@/components/settings-runtime";
import { usePathname } from "next/navigation";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") {
    return (
      <div className="min-h-screen bg-canvas">
        <SettingsRuntime />
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[248px_1fr]">
      <SettingsRuntime />
      <Sidebar />
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
