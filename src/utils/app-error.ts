export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export type ErrorDef = { message: string; code: string };

export function appError(def: ErrorDef, status: number): AppError {
  return new AppError(def.message, status, def.code);
}
