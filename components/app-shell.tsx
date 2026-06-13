"use client";

import { Sidebar } from "@/components/sidebar";
import { SettingsRuntime } from "@/components/settings-runtime";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const initialPathRef = useRef(pathname);

  useEffect(() => {
    const initialPath = initialPathRef.current;

    if (initialPath === "/login") {
      return;
    }

    let cancelled = false;

    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => {
        if (cancelled || response.ok) {
          return;
        }

        if (response.status === 401) {
          console.warn("[auth] app_shell_auth_check_failed", { status: response.status });
          const next = initialPath === "/" ? "" : `?next=${encodeURIComponent(initialPath)}`;
          router.replace(`/login${next}`);
          return;
        }

        console.warn("[auth] app_shell_auth_check_unexpected_status", {
          status: response.status
        });
      })
      .catch((error) => {
        console.warn("[auth] app_shell_auth_check_error", {
          message: error instanceof Error ? error.message : "unknown"
        });
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

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
