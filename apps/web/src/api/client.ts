import type { components } from "./schema.gen";

type HealthResponse = components["schemas"]["HealthResponse"];
type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, envelope: ErrorEnvelope) {
    super(envelope.error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = envelope.error.code;
  }
}

export async function getReadiness(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch("/api/v1/health/ready", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    const envelope = (await response.json()) as ErrorEnvelope;
    throw new ApiError(response.status, envelope);
  }

  return (await response.json()) as HealthResponse;
}
