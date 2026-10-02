import { describe, expect, it } from "vitest";
import {
  calculateFinancialSummary,
  type FinancialExpense,
  type FinancialSale,
} from "../src/domain/calculations";
import { calculateCommission } from "../src/domain/commissions";

function approvedSale(
  amountCents: number,
  project: "A" | "B",
  split: { richard: number; anastasia: number; jeanClaude: number },
): FinancialSale {
  return {
    amountCents,
    project,
    status: "APPROVED",
    commission: calculateCommission(amountCents, split),
  };
}

describe("financial calculations", () => {
  it("excludes pending sales but includes every recorded expense in company result", () => {
    const pendingSales: FinancialSale[] = [
      { amountCents: 100_000, project: "A", status: "PENDING_APPROVAL", commission: null },
      { amountCents: 200_000, project: "B", status: "PENDING_APPROVAL", commission: null },
    ];
    const expenses: FinancialExpense[] = [
      { amountCents: 12_000, status: "AWAITING_ALLOCATION", finalAllocation: null },
      { amountCents: 8_000, status: "AWAITING_ALLOCATION", finalAllocation: null },
      { amountCents: 10_000, status: "ALLOCATED", finalAllocation: "COMPANY_OVERHEAD" },
    ];

    const result = calculateFinancialSummary(pendingSales, expenses);
    expect(result.projects.A.resultCents).toBe(0);
    expect(result.projects.B.resultCents).toBe(0);
    expect(result.awaitingAllocationCents).toBe(20_000);
    expect(result.companyOverheadCents).toBe(10_000);
    expect(result.totalCompanyResultCents).toBe(-30_000);
    expect(result.approvedSalesCents).toBe(0);
    expect(result.totalCommissionExpenseCents).toBe(0);
    expect(result.allRecordedExpensesCents).toBe(30_000);
  });

  it("moves an awaiting expense into a project without charging the company twice", () => {
    const sale = approvedSale(100_000, "A", { richard: 50, anastasia: 30, jeanClaude: 20 });
    const awaiting = calculateFinancialSummary([sale], [
      { amountCents: 12_000, status: "AWAITING_ALLOCATION", finalAllocation: null },
    ]);
    const allocated = calculateFinancialSummary([sale], [
      { amountCents: 12_000, status: "ALLOCATED", finalAllocation: "A" },
    ]);

    expect(awaiting.totalCompanyResultCents).toBe(allocated.totalCompanyResultCents);
    expect(awaiting.projects.A.allocatedExpenseCents).toBe(0);
    expect(allocated.projects.A.allocatedExpenseCents).toBe(12_000);
  });

  it("reproduces Test 1 from transaction inputs without production constants", () => {
    const sales = [
      approvedSale(100_000, "A", { richard: 50, anastasia: 30, jeanClaude: 20 }),
      approvedSale(200_000, "B", { richard: 20, anastasia: 40, jeanClaude: 40 }),
    ];
    const expenses: FinancialExpense[] = [
      { amountCents: 12_000, status: "ALLOCATED", finalAllocation: "A" },
      { amountCents: 8_000, status: "ALLOCATED", finalAllocation: "A" },
      { amountCents: 10_000, status: "ALLOCATED", finalAllocation: "COMPANY_OVERHEAD" },
    ];

    const result = calculateFinancialSummary(sales, expenses);
    expect(result.projects.A.resultCents).toBe(70_000);
    expect(result.projects.B.resultCents).toBe(180_000);
    expect(result.totalCompanyResultCents).toBe(240_000);
    expect(result.individualCommissionCents).toEqual({
      richard: 9_000,
      anastasia: 11_000,
      jeanClaude: 10_000,
    });
  });

  it("reproduces cumulative Test 2 while retaining pending and awaiting records", () => {
    const sales: FinancialSale[] = [
      approvedSale(100_000, "A", { richard: 50, anastasia: 30, jeanClaude: 20 }),
      approvedSale(200_000, "B", { richard: 20, anastasia: 40, jeanClaude: 40 }),
      approvedSale(150_000, "A", { richard: 20, anastasia: 30, jeanClaude: 50 }),
      approvedSale(80_000, "B", { richard: 25, anastasia: 25, jeanClaude: 50 }),
      { amountCents: 60_000, project: "B", status: "PENDING_APPROVAL", commission: null },
    ];
    const expenses: FinancialExpense[] = [
      { amountCents: 12_000, status: "ALLOCATED", finalAllocation: "A" },
      { amountCents: 8_000, status: "ALLOCATED", finalAllocation: "A" },
      { amountCents: 10_000, status: "ALLOCATED", finalAllocation: "COMPANY_OVERHEAD" },
      { amountCents: 25_000, status: "ALLOCATED", finalAllocation: "B" },
      { amountCents: 9_000, status: "ALLOCATED", finalAllocation: "B" },
      { amountCents: 6_000, status: "ALLOCATED", finalAllocation: "COMPANY_OVERHEAD" },
      { amountCents: 14_000, status: "AWAITING_ALLOCATION", finalAllocation: null },
    ];

    const result = calculateFinancialSummary(sales, expenses);
    expect(result.projects.A.resultCents).toBe(205_000);
    expect(result.projects.B.resultCents).toBe(218_000);
    expect(result.companyOverheadCents).toBe(16_000);
    expect(result.awaitingAllocationCents).toBe(14_000);
    expect(result.totalCompanyResultCents).toBe(393_000);
    expect(result.individualCommissionCents).toEqual({
      richard: 14_000,
      anastasia: 17_500,
      jeanClaude: 21_500,
    });
  });
});
