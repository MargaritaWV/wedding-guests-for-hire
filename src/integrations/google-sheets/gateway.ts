import { createSign } from "node:crypto";
import { DomainError } from "@/src/domain/errors";
import { isConfiguredValue } from "@/src/integrations/config";

export type SheetTab = "Sales" | "Expenses";
export type SheetCell = string | number;

export interface SheetRow {
  reference: string;
  values: readonly SheetCell[];
}

export interface GoogleSheetsGateway {
  verifyConnection(): Promise<void>;
  ensureHeaders(): Promise<void>;
  upsertByReference(tab: SheetTab, row: SheetRow): Promise<{ rowNumber: number }>;
}

interface GoogleSheetsConfig {
  serviceAccountEmail: string;
  privateKey: string;
  spreadsheetId: string;
}

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

interface ValuesResponse {
  values?: SheetCell[][];
  updates?: { updatedRange?: string };
}

interface SpreadsheetMetadata {
  sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
}

type FetchLike = typeof fetch;

export const SALES_HEADERS = [
  "Reference",
  "Submission time",
  "Salesperson",
  "Customer",
  "Project",
  "Description",
  "Amount",
  "Richard proposed %",
  "Anastasia proposed %",
  "Jean-Claude proposed %",
  "Richard approved %",
  "Anastasia approved %",
  "Jean-Claude approved %",
  "Richard earned commission",
  "Anastasia earned commission",
  "Jean-Claude earned commission",
  "Status",
] as const;

export const EXPENSE_HEADERS = [
  "Reference",
  "Submission time",
  "Reporter",
  "Description",
  "Category",
  "Amount",
  "Proposed allocation",
  "Final allocation",
  "Status",
] as const;

const HEADERS: Record<SheetTab, readonly string[]> = {
  Sales: SALES_HEADERS,
  Expenses: EXPENSE_HEADERS,
};

class GoogleSheetsRequestError extends Error {
  constructor(readonly status: number) {
    super(`Google Sheets request failed (HTTP ${status}).`);
  }
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function configured(): GoogleSheetsConfig | null {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim().replaceAll("\\n", "\n");
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID?.trim();
  if (
    !serviceAccountEmail ||
    !privateKey ||
    !spreadsheetId ||
    !isConfiguredValue(serviceAccountEmail) ||
    !isConfiguredValue(privateKey) ||
    !isConfiguredValue(spreadsheetId)
  ) {
    return null;
  }
  if (!privateKey.includes("BEGIN PRIVATE KEY") || !privateKey.includes("END PRIVATE KEY")) {
    return null;
  }
  return { serviceAccountEmail, privateKey, spreadsheetId };
}

function range(tab: SheetTab, a1: string): string {
  return encodeURIComponent(`'${tab}'!${a1}`);
}

function rowNumberFromRange(updatedRange: string | undefined): number {
  const match = updatedRange?.match(/![A-Z]+(\d+):/i);
  const rowNumber = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(rowNumber) || rowNumber < 2) {
    throw new GoogleSheetsRequestError(502);
  }
  return rowNumber;
}

export function safeGoogleSheetsError(error: unknown): string {
  return error instanceof GoogleSheetsRequestError
    ? error.message
    : "Google Sheets synchronization failed.";
}

export class GoogleSheetsApiGateway implements GoogleSheetsGateway {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private metadata: SpreadsheetMetadata | null = null;
  private readonly preparedTabs = new Set<SheetTab>();

  constructor(
    private readonly config: GoogleSheetsConfig,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async verifyConnection(): Promise<void> {
    const metadata = await this.getMetadata(true);
    const titles = new Set(
      (metadata.sheets ?? []).map((sheet) => sheet.properties?.title).filter(Boolean),
    );
    if (!titles.has("Sales") || !titles.has("Expenses")) {
      throw new GoogleSheetsRequestError(404);
    }
  }

  async ensureHeaders(): Promise<void> {
    await this.prepareTab("Sales");
    await this.prepareTab("Expenses");
  }

  async upsertByReference(
    tab: SheetTab,
    row: SheetRow,
  ): Promise<{ rowNumber: number }> {
    const headers = HEADERS[tab];
    if (row.values.length !== headers.length || String(row.values[0]) !== row.reference) {
      throw new DomainError("PERSISTENCE_FAILED", "The Google Sheets row is invalid.");
    }
    await this.prepareTab(tab);
    const references = await this.getValues(tab, "A2:A");
    const normalizedReference = row.reference.trim().toUpperCase();
    const matches: number[] = [];
    for (let index = 0; index < references.length; index += 1) {
      if (String(references[index]?.[0] ?? "").trim().toUpperCase() === normalizedReference) {
        matches.push(index + 2);
      }
    }
    if (matches.length > 1) {
      throw new DomainError(
        "PERSISTENCE_FAILED",
        "The spreadsheet contains duplicate rows for this transaction reference.",
      );
    }
    if (matches.length === 1) {
      const rowNumber = matches[0];
      await this.updateValues(tab, `A${rowNumber}:${this.lastColumn(tab)}${rowNumber}`, [row.values]);
      return { rowNumber };
    }
    const response = await this.authorizedRequest<ValuesResponse>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.config.spreadsheetId)}/values/${range(tab, `A:${this.lastColumn(tab)}`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ majorDimension: "ROWS", values: [row.values] }),
      },
    );
    return { rowNumber: rowNumberFromRange(response.updates?.updatedRange) };
  }

  async readTable(tab: SheetTab): Promise<SheetCell[][]> {
    return this.getValues(tab, `A1:${this.lastColumn(tab)}`);
  }

  async deleteByReference(tab: SheetTab, reference: string): Promise<number> {
    const references = await this.getValues(tab, "A2:A");
    const target = reference.trim().toUpperCase();
    const rows = references
      .map((values, index) => ({ value: String(values[0] ?? "").trim().toUpperCase(), row: index + 2 }))
      .filter((entry) => entry.value === target)
      .map((entry) => entry.row)
      .sort((a, b) => b - a);
    if (!rows.length) return 0;
    const sheetId = await this.sheetId(tab);
    await this.authorizedRequest(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.config.spreadsheetId)}:batchUpdate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: rows.map((row) => ({
            deleteDimension: {
              range: { sheetId, dimension: "ROWS", startIndex: row - 1, endIndex: row },
            },
          })),
        }),
      },
    );
    return rows.length;
  }

  private async prepareTab(tab: SheetTab): Promise<void> {
    if (this.preparedTabs.has(tab)) return;
    const headers = HEADERS[tab];
    const existing = (await this.getValues(tab, `A1:${this.lastColumn(tab)}1`))[0] ?? [];
    const matches = headers.every((header, index) => existing[index] === header);
    if (!matches || existing.length !== headers.length) {
      await this.updateValues(tab, `A1:${this.lastColumn(tab)}1`, [headers]);
      await this.applyFormatting(tab);
    }
    this.preparedTabs.add(tab);
  }

  private async applyFormatting(tab: SheetTab): Promise<void> {
    const sheetId = await this.sheetId(tab);
    const headers = HEADERS[tab];
    const moneyColumns = tab === "Sales" ? [6, 13, 14, 15] : [5];
    await this.authorizedRequest(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.config.spreadsheetId)}:batchUpdate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                fields: "gridProperties.frozenRowCount",
              },
            },
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: headers.length },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.16, green: 0.29, blue: 0.48 },
                    textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  },
                },
                fields: "userEnteredFormat(backgroundColor,textFormat)",
              },
            },
            ...moneyColumns.map((column) => ({
              repeatCell: {
                range: { sheetId, startRowIndex: 1, startColumnIndex: column, endColumnIndex: column + 1 },
                cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: "€#,##0.00" } } },
                fields: "userEnteredFormat.numberFormat",
              },
            })),
            {
              autoResizeDimensions: {
                dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: headers.length },
              },
            },
          ],
        }),
      },
    );
  }

  private lastColumn(tab: SheetTab): string {
    return String.fromCharCode(64 + HEADERS[tab].length);
  }

  private async sheetId(tab: SheetTab): Promise<number> {
    const metadata = await this.getMetadata();
    const sheetId = metadata.sheets?.find((sheet) => sheet.properties?.title === tab)?.properties?.sheetId;
    if (!Number.isSafeInteger(sheetId)) throw new GoogleSheetsRequestError(404);
    return sheetId as number;
  }

  private async getMetadata(refresh = false): Promise<SpreadsheetMetadata> {
    if (!refresh && this.metadata) return this.metadata;
    this.metadata = await this.authorizedRequest<SpreadsheetMetadata>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.config.spreadsheetId)}?fields=sheets.properties(sheetId,title)`,
    );
    return this.metadata;
  }

  private async getValues(tab: SheetTab, a1: string): Promise<SheetCell[][]> {
    const response = await this.authorizedRequest<ValuesResponse>(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.config.spreadsheetId)}/values/${range(tab, a1)}`,
    );
    return response.values ?? [];
  }

  private async updateValues(tab: SheetTab, a1: string, values: readonly (readonly SheetCell[])[]) {
    await this.authorizedRequest(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.config.spreadsheetId)}/values/${range(tab, a1)}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ majorDimension: "ROWS", values }),
      },
    );
  }

  private async authorizedRequest<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    const response = await this.fetcher(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) throw new GoogleSheetsRequestError(response.status);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) return this.accessToken;
    const now = Math.floor(Date.now() / 1000);
    const encodedHeader = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const encodedClaims = base64Url(JSON.stringify({
      iss: this.config.serviceAccountEmail,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }));
    const unsigned = `${encodedHeader}.${encodedClaims}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    const assertion = `${unsigned}.${base64Url(signer.sign(this.config.privateKey))}`;
    const response = await this.fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new GoogleSheetsRequestError(response.status);
    const payload = await response.json() as TokenResponse;
    if (typeof payload.access_token !== "string" || !payload.access_token) {
      throw new GoogleSheetsRequestError(502);
    }
    this.accessToken = payload.access_token;
    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
    this.tokenExpiresAt = Date.now() + expiresIn * 1000;
    return this.accessToken;
  }
}

export function createGoogleSheetsGatewayIfConfigured(
  fetcher: FetchLike = fetch,
): GoogleSheetsApiGateway | null {
  const config = configured();
  return config ? new GoogleSheetsApiGateway(config, fetcher) : null;
}

export function createGoogleSheetsGateway(fetcher: FetchLike = fetch): GoogleSheetsApiGateway {
  const gateway = createGoogleSheetsGatewayIfConfigured(fetcher);
  if (!gateway) {
    throw new DomainError(
      "INTEGRATION_NOT_CONFIGURED",
      "Google Sheets is not configured. The synchronization job must remain pending.",
    );
  }
  return gateway;
}
