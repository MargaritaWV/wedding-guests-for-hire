import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createGoogleSheetsGatewayIfConfigured,
  GoogleSheetsApiGateway,
  SALES_HEADERS,
} from "../src/integrations/google-sheets/gateway";
import {
  serializeExpenseRow,
  serializeSaleRow,
} from "../src/integrations/google-sheets/rows";

const submittedAt = "2026-10-02T17:00:00.000Z";

describe("Google Sheets row serialization", () => {
  it("represents a pending sale with no approved split and zero commissions", () => {
    const row = serializeSaleRow({
      reference: "GSTEST-SALE",
      submittedAt,
      salesperson: "Richard Darling",
      customer: "Test Customer",
      project: "A",
      description: "Temporary test",
      amountCents: 12_345,
      proposedSplit: { richard: 40, anastasia: 30, jeanClaude: 30 },
      finalSplit: null,
      commission: null,
      status: "PENDING_APPROVAL",
    });
    expect(row.values).toHaveLength(SALES_HEADERS.length);
    expect(row.values.slice(10, 13)).toEqual(["", "", ""]);
    expect(row.values.slice(13, 16)).toEqual([0, 0, 0]);
    expect(row.values[16]).toBe("Pending approval");
  });

  it("represents an approved changed split and earned commissions", () => {
    const row = serializeSaleRow({
      reference: "GSTEST-SALE",
      submittedAt,
      salesperson: "Richard Darling",
      customer: "Test Customer",
      project: "B",
      description: "Temporary test",
      amountCents: 10_000,
      proposedSplit: { richard: 40, anastasia: 30, jeanClaude: 30 },
      finalSplit: { richard: 50, anastasia: 25, jeanClaude: 25 },
      commission: {
        poolCents: 1_000,
        richardCents: 500,
        anastasiaCents: 250,
        jeanClaudeCents: 250,
      },
      status: "APPROVED",
    });
    expect(row.values.slice(10, 16)).toEqual([50, 25, 25, 5, 2.5, 2.5]);
    expect(row.values[16]).toBe("Approved");
  });

  it("keeps proposed and final expense allocations separate", () => {
    const awaiting = serializeExpenseRow({
      reference: "GSTEST-EXP",
      submittedAt,
      reporter: "Kevin von Whatever",
      description: "Temporary travel",
      category: "Travel",
      amountCents: 2_500,
      proposedAllocation: "B",
      finalAllocation: null,
      status: "AWAITING_ALLOCATION",
    });
    expect(awaiting.values.slice(6)).toEqual(["Project B", "", "Awaiting allocation"]);

    const allocated = serializeExpenseRow({
      reference: "GSTEST-EXP",
      submittedAt,
      reporter: "Kevin von Whatever",
      description: "Temporary travel",
      category: "Travel",
      amountCents: 2_500,
      proposedAllocation: "B",
      finalAllocation: "A",
      status: "ALLOCATED",
    });
    expect(allocated.values.slice(6)).toEqual(["Project B", "Project A", "Allocated"]);
  });
});

describe("reference-based Google Sheets upsert", () => {
  it("inserts once and then updates the same row", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    let headers: unknown[][] = [];
    const rows: unknown[][] = [];
    let appends = 0;
    let rowUpdates = 0;
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
    const mockFetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = decodeURIComponent(String(input));
      const method = init?.method ?? "GET";
      if (url.includes("oauth2.googleapis.com/token")) {
        return response({ access_token: "unit-test-token", expires_in: 3600 });
      }
      if (url.includes("?fields=sheets.properties")) {
        return response({ sheets: [
          { properties: { sheetId: 1, title: "Sales" } },
          { properties: { sheetId: 2, title: "Expenses" } },
        ] });
      }
      if (url.includes(":batchUpdate")) return response({ replies: [] });
      if (method === "GET" && url.includes("'Sales'!A1:Q1")) return response({ values: headers });
      if (method === "PUT" && url.includes("'Sales'!A1:Q1")) {
        headers = (JSON.parse(String(init?.body)) as { values: unknown[][] }).values;
        return response({ updatedRange: "'Sales'!A1:Q1" });
      }
      if (method === "GET" && url.includes("'Sales'!A2:A")) {
        return response({ values: rows.map((row) => [row[0]]) });
      }
      if (method === "POST" && url.includes(":append")) {
        appends += 1;
        const values = (JSON.parse(String(init?.body)) as { values: unknown[][] }).values;
        rows.push(values[0]);
        return response({ updates: { updatedRange: "'Sales'!A2:Q2" } });
      }
      if (method === "PUT" && url.includes("'Sales'!A2:Q2")) {
        rowUpdates += 1;
        rows[0] = (JSON.parse(String(init?.body)) as { values: unknown[][] }).values[0];
        return response({ updatedRange: "'Sales'!A2:Q2" });
      }
      return response({}, 404);
    }) as typeof fetch;
    const gateway = new GoogleSheetsApiGateway({
      serviceAccountEmail: "unit-test@example.iam.gserviceaccount.com",
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      spreadsheetId: "unit-test-sheet",
    }, mockFetch);
    const pending = serializeSaleRow({
      reference: "GSTEST-SALE",
      submittedAt,
      salesperson: "Richard Darling",
      customer: "Customer",
      project: "A",
      description: "Temporary",
      amountCents: 10_000,
      proposedSplit: { richard: 50, anastasia: 30, jeanClaude: 20 },
      finalSplit: null,
      commission: null,
      status: "PENDING_APPROVAL",
    });
    expect(await gateway.upsertByReference("Sales", pending)).toEqual({ rowNumber: 2 });
    const approved = { ...pending, values: pending.values.map((value, index) => index === 16 ? "Approved" : value) };
    expect(await gateway.upsertByReference("Sales", approved)).toEqual({ rowNumber: 2 });
    expect(rows).toHaveLength(1);
    expect(appends).toBe(1);
    expect(rowUpdates).toBe(1);
    expect(rows[0][16]).toBe("Approved");
  });
});

describe("Google Sheets configuration security", () => {
  it("does not treat placeholder configuration as connected", () => {
    const original = {
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY,
      id: process.env.GOOGLE_SPREADSHEET_ID,
    };
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "service-account-name@project-id.iam.gserviceaccount.com";
    process.env.GOOGLE_PRIVATE_KEY = "replace_with_private_key";
    process.env.GOOGLE_SPREADSHEET_ID = "replace_with_spreadsheet_id";
    expect(createGoogleSheetsGatewayIfConfigured()).toBeNull();
    for (const [name, value] of [
      ["GOOGLE_SERVICE_ACCOUNT_EMAIL", original.email],
      ["GOOGLE_PRIVATE_KEY", original.key],
      ["GOOGLE_SPREADSHEET_ID", original.id],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("does not reference private Google configuration in the client component", () => {
    const clientSource = readFileSync("app/components/finance-app.tsx", "utf8");
    expect(clientSource).not.toContain("GOOGLE_PRIVATE_KEY");
    expect(clientSource).not.toContain("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  });
});
