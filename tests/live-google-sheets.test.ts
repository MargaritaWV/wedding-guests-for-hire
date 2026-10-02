import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TransactionProcessor } from "../src/application/transaction-processor";
import { calculateFinancialSummary } from "../src/domain/calculations";
import {
  createGoogleSheetsGateway,
  type GoogleSheetsGateway,
  type SheetRow,
  type SheetTab,
} from "../src/integrations/google-sheets/gateway";
import { getSupabaseAdminClient } from "../src/integrations/supabase/admin-client";
import { SupabaseSideEffectQueue } from "../src/integrations/supabase/side-effect-queue";
import { SupabaseTransactionRepository } from "../src/integrations/supabase/transaction-repository";

const live = process.env.RUN_LIVE_GOOGLE_SHEETS_TESTS === "1";
const suite = live ? describe : describe.skip;

suite("live Google Sheets synchronization", () => {
  const suffix = Date.now();
  const saleReference = `GSTEST-SALE-${suffix}`;
  const expenseReference = `GSTEST-EXP-${suffix}`;
  const failureReference = `GSTEST-FAIL-${suffix}`;

  beforeAll(() => {
    process.loadEnvFile?.(".env.local");
  });

  afterAll(async () => {
    if (!live) return;
    const client = getSupabaseAdminClient();
    const references = [saleReference, expenseReference, failureReference];
    const { data } = await client.from("transactions").select("id").in("reference", references);
    const ids = (data ?? []).map((row) => row.id);
    if (ids.length) {
      await client.from("notification_jobs").delete().in("transaction_id", ids);
      await client.from("google_sheet_sync_jobs").delete().in("transaction_id", ids);
      await client.from("manager_decisions").delete().in("transaction_id", ids);
      await client.from("sales").delete().in("transaction_id", ids);
      await client.from("expenses").delete().in("transaction_id", ids);
      await client.from("transactions").delete().in("id", ids);
    }
    const sheets = createGoogleSheetsGateway();
    await sheets.deleteByReference("Sales", saleReference);
    await sheets.deleteByReference("Expenses", expenseReference);
    await sheets.deleteByReference("Sales", failureReference);
    const remainingTransactions = await client
      .from("transactions")
      .select("*", { count: "exact", head: true })
      .in("reference", references);
    expect(remainingTransactions.count).toBe(0);
    expect((await sheets.readTable("Sales")).filter((row) =>
      row[0] === saleReference || row[0] === failureReference
    )).toHaveLength(0);
    expect((await sheets.readTable("Expenses")).filter((row) =>
      row[0] === expenseReference
    )).toHaveLength(0);
  });

  it("inserts submissions and updates the same rows after manager decisions", async () => {
    const client = getSupabaseAdminClient();
    const repository = new SupabaseTransactionRepository(client);
    const sheets = createGoogleSheetsGateway();
    const sideEffects = new SupabaseSideEffectQueue(client, null, sheets);
    const processor = new TransactionProcessor(repository, sideEffects);
    const richard = await repository.resolveActor("richard");
    const kevin = await repository.resolveActor("kevin");
    const manager = await repository.resolveActor("svetlana");

    const sale = await processor.submitSale(richard, { origin: "website" }, {
      reference: saleReference,
      customer: "Stage 4 temporary customer",
      project: "A",
      description: "Temporary real Google Sheets sale",
      amountCents: 12_345,
      proposedSplit: { richard: 40, anastasia: 30, jeanClaude: 30 },
    });
    const expense = await processor.submitExpense(kevin, { origin: "website" }, {
      reference: expenseReference,
      description: "Temporary real Google Sheets expense",
      category: "Travel",
      amountCents: 2_500,
      proposedAllocation: "B",
    });

    const [saleJob, expenseJob] = await Promise.all([
      client.from("google_sheet_sync_jobs").select("state,row_number").eq("transaction_id", sale.transactionId).single(),
      client.from("google_sheet_sync_jobs").select("state,row_number").eq("transaction_id", expense.transactionId).single(),
    ]);
    expect(saleJob.data?.state).toBe("SYNCED");
    expect(expenseJob.data?.state).toBe("SYNCED");

    const pendingSales = await sheets.readTable("Sales");
    const awaitingExpenses = await sheets.readTable("Expenses");
    const pendingRows = pendingSales.filter((row) => row[0] === saleReference);
    const awaitingRows = awaitingExpenses.filter((row) => row[0] === expenseReference);
    expect(pendingRows).toHaveLength(1);
    expect(pendingRows[0].slice(10, 13)).toEqual(["", "", ""]);
    expect(pendingRows[0].slice(13, 17)).toEqual(["0", "0", "0", "Pending approval"]);
    expect(awaitingRows).toHaveLength(1);
    expect(awaitingRows[0].slice(6)).toEqual(["Project B", "", "Awaiting allocation"]);

    await processor.approveSale(manager, {
      transactionId: sale.transactionId,
      finalSplit: { richard: 50, anastasia: 25, jeanClaude: 25 },
    });
    await processor.allocateExpense(manager, {
      transactionId: expense.transactionId,
      finalAllocation: "A",
    });

    const finalSales = (await sheets.readTable("Sales")).filter((row) => row[0] === saleReference);
    const finalExpenses = (await sheets.readTable("Expenses")).filter((row) => row[0] === expenseReference);
    expect(finalSales).toHaveLength(1);
    expect(finalSales[0].slice(10, 17)).toEqual(["50", "25", "25", "6.19", "3.08", "3.08", "Approved"]);
    expect(finalExpenses).toHaveLength(1);
    expect(finalExpenses[0].slice(6)).toEqual(["Project B", "Project A", "Allocated"]);
    expect((await client.from("transactions").select("*", { count: "exact", head: true }).in("reference", [saleReference, expenseReference])).count).toBe(2);
  }, 90_000);

  it("records a controlled failure and retries without duplicate financial effects", async () => {
    const client = getSupabaseAdminClient();
    const repository = new SupabaseTransactionRepository(client);
    const realSheets = createGoogleSheetsGateway();
    let attempts = 0;
    const controlledGateway: GoogleSheetsGateway = {
      verifyConnection: () => realSheets.verifyConnection(),
      ensureHeaders: () => realSheets.ensureHeaders(),
      async upsertByReference(tab: SheetTab, row: SheetRow) {
        attempts += 1;
        if (attempts === 1) throw new Error("Controlled Stage 4 synchronization failure");
        return realSheets.upsertByReference(tab, row);
      },
    };
    const sideEffects = new SupabaseSideEffectQueue(client, null, controlledGateway);
    const processor = new TransactionProcessor(repository, sideEffects);
    const richard = await repository.resolveActor("richard");
    const manager = await repository.resolveActor("svetlana");
    const sale = await processor.submitSale(richard, { origin: "website" }, {
      reference: failureReference,
      customer: "Controlled failure customer",
      project: "B",
      description: "Temporary controlled retry verification",
      amountCents: 10_000,
      proposedSplit: { richard: 50, anastasia: 30, jeanClaude: 20 },
    });
    const failed = await client
      .from("google_sheet_sync_jobs")
      .select("state,attempt_count,last_error")
      .eq("transaction_id", sale.transactionId)
      .single();
    expect(failed.data?.state).toBe("FAILED");
    expect(failed.data?.attempt_count).toBe(1);
    expect(failed.data?.last_error).toBe("Google Sheets synchronization failed.");

    const before = await repository.getSnapshot(manager);
    const beforeSummary = calculateFinancialSummary(
      before.sales.filter((record) => record.reference === failureReference),
      [],
    );
    expect(await sideEffects.retrySheetSync(manager, sale.transactionId)).toBe("SYNCED");
    const after = await repository.getSnapshot(manager);
    const afterSummary = calculateFinancialSummary(
      after.sales.filter((record) => record.reference === failureReference),
      [],
    );
    expect(afterSummary.totalCompanyResultCents).toBe(beforeSummary.totalCompanyResultCents);
    expect((await realSheets.readTable("Sales")).filter((row) => row[0] === failureReference)).toHaveLength(1);
    expect((await client.from("transactions").select("*", { count: "exact", head: true }).eq("reference", failureReference)).count).toBe(1);
  }, 90_000);
});
