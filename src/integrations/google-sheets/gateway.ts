import { DomainError } from "@/src/domain/errors";

export type SheetTab = "Sales" | "Expenses";

export interface SheetRow {
  reference: string;
  valuesByColumn: Readonly<Record<string, string | number>>;
}

export interface GoogleSheetsGateway {
  /** Update the existing reference row or insert it once if it does not exist. */
  upsertByReference(tab: SheetTab, row: SheetRow): Promise<{ rowNumber: number }>;
}

/**
 * The interface is ready, but the authenticated Google adapter is intentionally deferred.
 * Calling this now fails honestly instead of pretending a row was synchronized.
 */
export function createGoogleSheetsGateway(): GoogleSheetsGateway {
  const hasConfiguration = Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() &&
      process.env.GOOGLE_PRIVATE_KEY?.trim() &&
      process.env.GOOGLE_SPREADSHEET_ID?.trim(),
  );

  if (!hasConfiguration) {
    throw new DomainError(
      "INTEGRATION_NOT_CONFIGURED",
      "Google Sheets is not configured. The synchronization job must remain pending.",
    );
  }

  throw new DomainError(
    "INTEGRATION_NOT_CONFIGURED",
    "Google Sheets credentials are present, but the authenticated adapter is scheduled for Stage 3 and has not run.",
  );
}
