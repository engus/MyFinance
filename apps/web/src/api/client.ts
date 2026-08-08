import type { components } from "./schema.gen";

type HealthResponse = components["schemas"]["HealthResponse"];
type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];
export type AuthResponse = components["schemas"]["AuthResponse"];
export type User = components["schemas"]["User"];
export type LoginRequest = components["schemas"]["LoginRequest"];

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: Record<string, string>;

  constructor(status: number, envelope: ErrorEnvelope) {
    super(envelope.error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = envelope.error.code;
    this.fields = envelope.error.fields;
  }
}

async function errorFromResponse(response: Response): Promise<ApiError> {
  try {
    return new ApiError(response.status, (await response.json()) as ErrorEnvelope);
  } catch {
    return new ApiError(response.status, {
      error: {
        code: "unexpected_response",
        message: "The server returned an unexpected response.",
      },
    });
  }
}

export async function getReadiness(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch("/api/v1/health/ready", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw await errorFromResponse(response);
  }

  return (await response.json()) as HealthResponse;
}

export async function getCurrentUser(signal?: AbortSignal): Promise<User | null> {
  const response = await fetch("/api/v1/auth/me", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });

  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw await errorFromResponse(response);
  }

  return ((await response.json()) as AuthResponse).user;
}

export async function login(payload: LoginRequest): Promise<User> {
  const response = await fetch("/api/v1/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await errorFromResponse(response);
  }

  return ((await response.json()) as AuthResponse).user;
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/v1/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw await errorFromResponse(response);
  }
}
