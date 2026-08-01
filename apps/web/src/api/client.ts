let csrfToken: string | null = null;

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export async function apiFetch(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (csrfToken && options.method && options.method !== 'GET') {
    headers.set('X-CSRF-Token', csrfToken);
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }

  return response.status === 204 ? null : response.json();
}
