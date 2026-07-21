export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** GETs get a timeout so a hung/unreachable API surfaces an error instead of
 *  spinning forever (blank drawers, stuck skeletons). Mutations are left
 *  untimed since they may legitimately be long-running. */
const DEFAULT_TIMEOUT_MS = 30_000;

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const signal =
    init?.signal ?? (method === "GET" ? AbortSignal.timeout(DEFAULT_TIMEOUT_MS) : undefined);

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      signal,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    throw new ApiRequestError(
      timedOut
        ? "The server didn't respond — it may be restarting. Try again in a moment."
        : "Couldn't reach the MetaMagic server.",
      0,
    );
  }
  if (!res.ok) {
    if (
      res.status === 401 &&
      !path.startsWith("/api/auth/") &&
      typeof window !== "undefined" &&
      window.location.pathname !== "/login"
    ) {
      window.location.href = "/login";
    }
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body
    }
    throw new ApiRequestError(message, res.status);
  }
  return (await res.json()) as T;
}
