import type { Category } from "@/types/finance";

const categoriesCacheTtlMs = 15_000;
let categoriesCache:
  | {
      data: Category[];
      expiresAt: number;
    }
  | null = null;
let categoriesRequest: Promise<Category[]> | null = null;

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
