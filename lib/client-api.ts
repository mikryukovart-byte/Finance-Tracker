import type { Account, Category } from "@/types/finance";

const categoriesCacheTtlMs = 15_000;
const defaultJsonCacheTtlMs = 20_000;
let categoriesCache:
  | {
      data: Category[];
      expiresAt: number;
    }
  | null = null;
let categoriesRequest: Promise<Category[]> | null = null;
const jsonCache = new Map<string, { data: unknown; expiresAt: number }>();
const jsonRequests = new Map<string, Promise<unknown>>();

export async function readErrorMessage(response: Response) {
  const body = await response.json().catch(() => null);
  return body?.message ?? "Не удалось выполнить действие";
}

export async function fetchCategories(options: { force?: boolean } = {}) {
  const now = Date.now();

  if (!options.force && categoriesCache && categoriesCache.expiresAt > now) {
    return categoriesCache.data;
  }

  if (!options.force && categoriesRequest) {
    return categoriesRequest;
  }

  categoriesRequest = fetch("/api/categories", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data: Category[] = await response.json();
      categoriesCache = {
        data,
        expiresAt: Date.now() + categoriesCacheTtlMs
      };
      return data;
    })
    .finally(() => {
      categoriesRequest = null;
    });

  return categoriesRequest;
}

export function setCachedCategories(categories: Category[]) {
  categoriesCache = {
    data: categories,
    expiresAt: Date.now() + categoriesCacheTtlMs
  };
}

export function invalidateCategoriesCache() {
  categoriesCache = null;
  categoriesRequest = null;
}

export function readClientCache<T>(key: string) {
  const cached = jsonCache.get(key);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    jsonCache.delete(key);
    return null;
  }

  return cached.data as T;
}

export function setClientCache<T>(key: string, data: T, ttlMs = defaultJsonCacheTtlMs) {
  jsonCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs
  });
}

export function invalidateClientCache(prefix?: string) {
  if (!prefix) {
    jsonCache.clear();
    jsonRequests.clear();
    return;
  }

  for (const key of Array.from(jsonCache.keys())) {
    if (key.startsWith(prefix)) {
      jsonCache.delete(key);
    }
  }

  for (const key of Array.from(jsonRequests.keys())) {
    if (key.startsWith(prefix)) {
      jsonRequests.delete(key);
    }
  }
}

export function invalidateFinancialDataCache() {
  [
    "accounts:",
    "advisor:",
    "dashboard:",
    "loans:",
    "reports:",
    "transactions:",
    "transfers:",
    "truth:"
  ].forEach((prefix) => invalidateClientCache(prefix));
}

export async function fetchJsonCached<T>(
  key: string,
  url: string,
  options: { force?: boolean; ttlMs?: number } = {}
) {
  if (!options.force) {
    const cached = readClientCache<T>(key);

    if (cached) {
      return cached;
    }

    const pending = jsonRequests.get(key);

    if (pending) {
      return pending as Promise<T>;
    }
  }

  const request = fetch(url, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data: T = await response.json();
      setClientCache(key, data, options.ttlMs ?? defaultJsonCacheTtlMs);
      return data;
    })
    .finally(() => {
      jsonRequests.delete(key);
    });

  jsonRequests.set(key, request);
  return request;
}

export function accountCacheKey(withCounts = false) {
  return withCounts ? "accounts:with-counts" : "accounts:basic";
}

export async function fetchAccounts(
  options: { withCounts?: boolean; force?: boolean } = {}
) {
  return fetchJsonCached<{ accounts: Account[]; totalBalance: number }>(
    accountCacheKey(Boolean(options.withCounts)),
    options.withCounts ? "/api/accounts?withCounts=1" : "/api/accounts",
    {
      force: options.force,
      ttlMs: 12_000
    }
  );
}

export function buildQuery(params: Record<string, string>) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }

  const value = query.toString();
  return value ? `?${value}` : "";
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
