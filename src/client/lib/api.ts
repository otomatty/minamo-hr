export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const res = await fetch(`/api${url}`, init);
  if (res.status === 401 && !url.startsWith("/auth/login") && !url.startsWith("/auth/me")) onUnauthorized?.();
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? `エラーが発生しました (${res.status})`);
  // 更新系の操作のあとはサイドバーの件数などを取り直す
  if (method !== "GET" && !url.startsWith("/notifications") && !url.startsWith("/auth")) window.dispatchEvent(new Event("minamo:changed"));
  return data as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export const api = {
  get: <T = any>(url: string) => request<T>("GET", url),
  post: <T = any>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {}),
  del: <T = any>(url: string) => request<T>("DELETE", url),
  upload: <T = any>(url: string, form: FormData) => request<T>("POST", url, form),
};

/** CSV などのダウンロード */
export function downloadUrl(url: string) {
  const a = document.createElement("a");
  a.href = `/api${url}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
