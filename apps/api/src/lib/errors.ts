import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string[]>
  ) {
    super(message);
  }
}

export function validationError(error: ZodError): AppError {
  const flattened = error.flatten();
  const fields = Object.fromEntries(
    Object.entries(flattened.fieldErrors).filter((entry): entry is [string, string[]] =>
      Boolean(entry[1])
    )
  );
  return new AppError(400, 'VALIDATION_ERROR', 'The request is invalid', fields);
}
