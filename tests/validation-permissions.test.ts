import { describe, expect, it } from "vitest";
import { canPerform } from "../src/domain/permissions";
import { expenseSubmissionSchema, saleSubmissionSchema } from "../src/domain/validation";
import { parseEuroAmountToCents } from "../src/domain/money";

describe("permissions", () => {
  it("enforces the assignment roles in processing logic", () => {
    expect(canPerform("salesperson", "submit_sale")).toBe(true);
    expect(canPerform("salesperson", "submit_expense")).toBe(false);
    expect(canPerform("expense_reporter", "submit_sale")).toBe(false);
    expect(canPerform("expense_reporter", "submit_expense")).toBe(true);
    expect(canPerform("manager", "make_manager_decision")).toBe(true);
    expect(canPerform("salesperson", "make_manager_decision")).toBe(false);
    expect(canPerform("manager", "retry_sheet_sync")).toBe(true);
    expect(canPerform("salesperson", "retry_sheet_sync")).toBe(false);
    expect(canPerform("expense_reporter", "retry_sheet_sync")).toBe(false);
  });
});

describe("transaction validation", () => {
  it("refuses a commission split that does not total 100%", () => {
    const result = saleSubmissionSchema.safeParse({
      reference: "S99",
      customer: "Test Customer",
      project: "A",
      description: "Dynamic test sale",
      amountCents: 100_00,
      proposedSplit: { richard: 60, anastasia: 30, jeanClaude: 20 },
    });
    expect(result.success).toBe(false);
  });

  it("refuses missing and zero expense amounts", () => {
    const base = {
      reference: "E99",
      description: "Dynamic test expense",
      category: "Other",
      proposedAllocation: "COMPANY_OVERHEAD",
    };
    expect(expenseSubmissionSchema.safeParse(base).success).toBe(false);
    expect(expenseSubmissionSchema.safeParse({ ...base, amountCents: 0 }).success).toBe(false);
  });

  it("refuses zero, negative, missing, and malformed sale values", () => {
    const valid = {
      reference: "S99",
      customer: "Test Customer",
      project: "A",
      description: "Dynamic test sale",
      amountCents: 100_00,
      proposedSplit: { richard: 40, anastasia: 30, jeanClaude: 30 },
    };
    expect(saleSubmissionSchema.safeParse({ ...valid, amountCents: 0 }).success).toBe(false);
    expect(saleSubmissionSchema.safeParse({ ...valid, amountCents: -1 }).success).toBe(false);
    expect(saleSubmissionSchema.safeParse({ ...valid, customer: "" }).success).toBe(false);
    expect(() => parseEuroAmountToCents("-1.00")).toThrow();
    expect(() => parseEuroAmountToCents("1.999")).toThrow();
    expect(parseEuroAmountToCents("12,34")).toBe(1_234);
  });
});
