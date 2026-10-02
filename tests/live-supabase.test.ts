import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServerServices } from "../src/application/server-services";
import { calculateFinancialSummary } from "../src/domain/calculations";

const live = process.env.RUN_LIVE_SUPABASE_TESTS === "1";
const suite = live ? describe : describe.skip;

suite("live Supabase persistence smoke test", () => {
  const suffix = `${Date.now()}`;
  const saleReference = `TMP_STAGE2_${suffix}_S`;
  const expenseReference = `TMP_STAGE2_${suffix}_E`;
  const transactionIds: string[] = [];

  beforeAll(() => {
    process.loadEnvFile?.(".env.local");
  });

  afterAll(async () => {
    if (!live || transactionIds.length === 0) return;
    const { client } = createServerServices();
    await client.from("notification_jobs").delete().in("transaction_id", transactionIds);
    await client.from("google_sheet_sync_jobs").delete().in("transaction_id", transactionIds);
    await client.from("manager_decisions").delete().in("transaction_id", transactionIds);
    await client.from("sales").delete().in("transaction_id", transactionIds);
    await client.from("expenses").delete().in("transaction_id", transactionIds);
    await client.from("transactions").delete().in("id", transactionIds);
  });

  it("writes, rereads, decides, calculates, and leaves cleanup to afterAll", async () => {
    const first = createServerServices();
    await first.repository.verifyConnection();
    const salesperson = await first.repository.resolveActor("richard");
    const reporter = await first.repository.resolveActor("kevin");
    const manager = await first.repository.resolveActor("svetlana");

    const sale = await first.processor.submitSale(salesperson, { origin: "website" }, {
      reference: saleReference,
      customer: "Stage 2 temporary verification",
      project: "A",
      description: "Temporary persistence test; removed automatically",
      amountCents: 12_345,
      proposedSplit: { richard: 40, anastasia: 30, jeanClaude: 30 },
    });
    transactionIds.push(sale.transactionId);
    const expense = await first.processor.submitExpense(reporter, { origin: "website" }, {
      reference: expenseReference,
      description: "Temporary allocation test; removed automatically",
      category: "Other",
      amountCents: 1_234,
      proposedAllocation: "A",
    });
    transactionIds.push(expense.transactionId);

    const reread = createServerServices();
    const pendingSnapshot = await reread.repository.getSnapshot(manager);
    expect(pendingSnapshot.sales.find((record) => record.reference === saleReference)?.status)
      .toBe("PENDING_APPROVAL");
    expect(pendingSnapshot.expenses.find((record) => record.reference === expenseReference)?.status)
      .toBe("AWAITING_ALLOCATION");

    const before = calculateFinancialSummary(
      pendingSnapshot.sales.filter((record) => record.reference === saleReference),
      pendingSnapshot.expenses.filter((record) => record.reference === expenseReference),
    );
    expect(before.approvedSalesCents).toBe(0);
    expect(before.totalCompanyResultCents).toBe(-1_234);
    expect(before.projects.A.allocatedExpenseCents).toBe(0);

    await reread.processor.approveSale(manager, {
      transactionId: sale.transactionId,
      finalSplit: { richard: 30, anastasia: 40, jeanClaude: 30 },
    });
    await reread.processor.allocateExpense(manager, {
      transactionId: expense.transactionId,
      finalAllocation: "B",
    });

    const persisted = await createServerServices().repository.getSnapshot(manager);
    const persistedSale = persisted.sales.find((record) => record.reference === saleReference);
    const persistedExpense = persisted.expenses.find((record) => record.reference === expenseReference);
    expect(persistedSale?.proposedSplit).toEqual({ richard: 40, anastasia: 30, jeanClaude: 30 });
    expect(persistedSale?.finalSplit).toEqual({ richard: 30, anastasia: 40, jeanClaude: 30 });
    expect(persistedExpense?.proposedAllocation).toBe("A");
    expect(persistedExpense?.finalAllocation).toBe("B");

    const repeat = await reread.processor.approveSale(manager, {
      transactionId: sale.transactionId,
      finalSplit: { richard: 30, anastasia: 40, jeanClaude: 30 },
    });
    expect(repeat.transitioned).toBe(false);
  }, 60_000);
});
