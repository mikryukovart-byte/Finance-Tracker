"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Notice } from "@/components/notice";
import { readErrorMessage } from "@/lib/client-api";

type AuthMode = "login" | "register";

export function AuthClient() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"neutral" | "success" | "error">("neutral");
  const [busy, setBusy] = useState(false);

  const nextPath = useMemo(() => {
    if (typeof window === "undefined") {
      return "/";
    }

    const value = new URLSearchParams(window.location.search).get("next");
    return value?.startsWith("/") ? value : "/";
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!email.trim() || !password) {
      setMessage("Введите email и пароль");
      setTone("error");
      return;
    }

    if (mode === "register" && password.length < 6) {
      setMessage("Пароль должен быть не короче 6 символов");
      setTone("error");
      return;
    }

    setBusy(true);

    try {
      const response = await fetch(mode === "login" ? "/api/auth/sign-in" : "/api/auth/sign-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const result = await response.json();

      if (mode === "register" && !result.authenticated) {
        setMessage(result.message ?? "Аккаунт создан. Проверьте почту.");
        setTone("success");
        return;
      }

      router.replace(nextPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось выполнить вход");
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
      <section className="card w-full p-5 sm:p-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink">
            {mode === "login" ? "Вход" : "Регистрация"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            Данные хранятся отдельно для каждого аккаунта.
          </p>
        </div>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div>
            <label className="field-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="field mt-1"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
            />
          </div>

          <div>
            <label className="field-label" htmlFor="password">
              Пароль
            </label>
            <input
              id="password"
              className="field mt-1"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Минимум 6 символов"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Подождите" : mode === "login" ? "Войти" : "Создать аккаунт"}
          </button>
        </form>

        <div className="mt-4">
          <Notice message={message} tone={tone} />
        </div>

        <button
          type="button"
          className="mt-4 text-sm font-medium text-muted transition hover:text-ink"
          onClick={() => {
            setMode((current) => (current === "login" ? "register" : "login"));
            setMessage("");
          }}
        >
          {mode === "login" ? "Создать новый аккаунт" : "Уже есть аккаунт"}
        </button>
      </section>
    </div>
  );
}
