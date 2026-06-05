export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function postJSON<T = any>(url: string, body: unknown, options?: { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), options?.timeoutMs ?? 12000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(String(payload?.error || response.statusText || "Request failed"), response.status);
    }

    return payload as T;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function postJSONWithRetry<T = any>(
  url: string,
  body: unknown,
  options?: {
    maxAttempts?: number;
    timeoutMs?: number;
    onRetry?: (attempt: number, maxAttempts: number) => void;
  }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 4;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await postJSON<T>(url, body, { timeoutMs: options?.timeoutMs });
    } catch (error) {
      lastError = error;
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401) break;
      if (attempt < maxAttempts) {
        options?.onRetry?.(attempt + 1, maxAttempts);
        await new Promise((resolve) => window.setTimeout(resolve, 350 * attempt + Math.floor(Math.random() * 180)));
      }
    }
  }

  throw lastError || new Error("Request failed");
}
