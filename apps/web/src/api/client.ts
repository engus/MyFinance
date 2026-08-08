import type { components } from "./schema.gen";

type HealthResponse = components["schemas"]["HealthResponse"];
type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];
export type AuthResponse = components["schemas"]["AuthResponse"];
export type User = components["schemas"]["User"];
export type LoginRequest = components["schemas"]["LoginRequest"];
export type RegisterRequest = components["schemas"]["RegisterRequest"];
export type LoginChallengeResponse = components["schemas"]["LoginChallengeResponse"];
export type CompleteOnboardingRequest = components["schemas"]["CompleteOnboardingRequest"];
export type Session = components["schemas"]["Session"];
export type UpdateProfileRequest = components["schemas"]["UpdateProfileRequest"];
export type UpdateUserSettingsRequest = components["schemas"]["UpdateUserSettingsRequest"];
export type ChangePasswordRequest = components["schemas"]["ChangePasswordRequest"];
export type TOTPSetupResponse = components["schemas"]["TOTPSetupResponse"];

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

export async function login(payload: LoginRequest): Promise<User | LoginChallengeResponse> {
  const response = await fetch("/api/v1/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await errorFromResponse(response);
  }

  if (response.status === 202) {
    return (await response.json()) as LoginChallengeResponse;
  }
  return ((await response.json()) as AuthResponse).user;
}

export async function register(payload: RegisterRequest): Promise<User> {
  return authMutation("/api/v1/auth/register", "POST", payload);
}

export async function verifyLoginTOTP(challengeToken: string, code: string): Promise<User> {
  return authMutation("/api/v1/auth/login/totp", "POST", { challengeToken, code });
}

export async function verifyLoginRecoveryCode(
  challengeToken: string,
  recoveryCode: string,
): Promise<User> {
  return authMutation("/api/v1/auth/login/recovery", "POST", {
    challengeToken,
    recoveryCode,
  });
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

export async function completeOnboarding(payload: CompleteOnboardingRequest): Promise<User> {
  const response = await jsonRequest("/api/v1/onboarding/complete", "POST", payload);
  return (response as components["schemas"]["CompleteOnboardingResponse"]).user;
}

export async function listSessions(): Promise<Session[]> {
  const response = await jsonRequest("/api/v1/auth/sessions", "GET");
  return (response as components["schemas"]["SessionListResponse"]).sessions;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await jsonRequest(`/api/v1/auth/sessions/${sessionId}`, "DELETE");
}

export async function updateProfile(payload: UpdateProfileRequest): Promise<User> {
  return authMutation("/api/v1/users/me", "PATCH", payload);
}

export async function changePassword(payload: ChangePasswordRequest): Promise<void> {
  await jsonRequest("/api/v1/users/me/password", "PUT", payload);
}

export async function updateSettings(payload: UpdateUserSettingsRequest): Promise<User> {
  return authMutation("/api/v1/users/me/settings", "PATCH", payload);
}

export async function deleteAccount(password: string): Promise<void> {
  await jsonRequest("/api/v1/users/me", "DELETE", { password });
}

export async function setupTOTP(): Promise<TOTPSetupResponse> {
  return (await jsonRequest("/api/v1/auth/totp/setup", "POST")) as TOTPSetupResponse;
}

export async function confirmTOTP(code: string): Promise<string[]> {
  const response = await jsonRequest("/api/v1/auth/totp/confirm", "POST", { code });
  return (response as components["schemas"]["TOTPConfirmResponse"]).recoveryCodes;
}

export async function disableTOTP(password: string, code: string): Promise<void> {
  await jsonRequest("/api/v1/auth/totp/disable", "POST", { password, code });
}

async function authMutation(path: string, method: string, body: unknown): Promise<User> {
  const response = await jsonRequest(path, method, body);
  return (response as AuthResponse).user;
}

async function jsonRequest(path: string, method: string, body?: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    throw await errorFromResponse(response);
  }
  if (response.status === 204) {
    return undefined;
  }
  return response.json();
}
