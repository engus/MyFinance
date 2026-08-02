let csrfToken: string | null = null;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string[]>
  ) {
    super(message);
  }
}

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  const method = options.method?.toUpperCase() ?? 'GET';
  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method))
    headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'include' });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string; fields?: Record<string, string[]> };
    };
    throw new ApiError(
      response.status,
      body.error?.code ?? 'REQUEST_FAILED',
      body.error?.message ?? `Request failed with status ${response.status}`,
      body.error?.fields
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
