"use client";

import {
  BarChart3,
  Brain,
  CreditCard,
  FolderTree,
  Home,
  Landmark,
  ListChecks,
  LogOut,
  Scale,
  Settings
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/", label: "Главная", icon: Home },
  { href: "/truth", label: "Правда", icon: Scale },
  { href: "/accounts", label: "Счета", icon: Landmark },
  { href: "/operations", label: "Операции", icon: ListChecks },
  { href: "/categories", label: "Категории", icon: FolderTree },
  { href: "/loans", label: "Кредиты", icon: CreditCard },
  { href: "/reports", label: "Отчеты", icon: BarChart3 },
  { href: "/advisor", label: "Советник", icon: Brain },
  { href: "/settings", label: "Настройки", icon: Settings }
];

export function Sidebar() {
  const pathname = usePathname();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.href = "/login";
  }

  return (
    <aside className="border-b border-line bg-sidebar px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r lg:px-4 lg:py-5">
      <div className="flex items-center justify-between gap-4 lg:block">
        <Link href="/" className="block">
          <div className="text-base font-semibold text-ink">Финансы</div>
          <div className="mt-0.5 text-xs text-muted">Личный учет</div>
        </Link>
      </div>

      <nav className="mt-4 flex gap-1 overflow-x-auto pb-1 lg:mt-7 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
        {navigation.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm transition lg:w-full ${
                active
                  ? "bg-soft text-ink"
                  : "text-muted hover:bg-soft hover:text-ink"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        className="mt-4 flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted transition hover:bg-soft hover:text-ink"
        onClick={logout}
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Выйти
      </button>
    </aside>
  );
}
