"use client";

import { Sidebar } from "@/components/sidebar";
import { SettingsRuntime } from "@/components/settings-runtime";
import { confirmClientAuthenticated } from "@/lib/client-api";
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

    confirmClientAuthenticated()
      .then((authenticated) => {
        if (cancelled || authenticated !== false) {
          return;
        }

        console.warn("[auth] app_shell_auth_check_failed");
        const next = initialPath === "/" ? "" : `?next=${encodeURIComponent(initialPath)}`;
        router.replace(`/login${next}`);
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
    <div
      data-testid="app-shell"
      className="min-h-screen bg-canvas lg:grid lg:grid-cols-[248px_1fr]"
    >
      <SettingsRuntime />
      <Sidebar />
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
