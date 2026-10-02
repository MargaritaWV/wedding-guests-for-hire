export type DomainErrorCode =
  | "PERMISSION_DENIED"
  | "VALIDATION_FAILED"
  | "DUPLICATE_REFERENCE"
  | "TRANSACTION_NOT_FOUND"
  | "ALREADY_DECIDED"
  | "PERSISTENCE_FAILED"
  | "INTEGRATION_NOT_CONFIGURED";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
