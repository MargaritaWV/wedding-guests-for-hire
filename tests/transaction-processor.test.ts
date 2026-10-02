import { describe, expect, it } from "vitest";
import type { SideEffectQueue, TransactionRepository } from "../src/application/ports";
import { TransactionProcessor } from "../src/application/transaction-processor";
import { DomainError } from "../src/domain/errors";
import type {
  Actor,
  CommissionAmounts,
  ExpenseAllocationInput,
  ExpenseSubmissionInput,
  PersistedExpense,
  PersistedSale,
  SaleApprovalInput,
  SaleSubmissionInput,
  SubmissionContext,
  TransitionResult,
} from "../src/domain/types";

const richard: Actor = {
  employeeId: "00000000-0000-4000-8000-000000000001",
  employeeCode: "richard",
  role: "salesperson",
};
const kevin: Actor = {
  employeeId: "00000000-0000-4000-8000-000000000002",
  employeeCode: "kevin",
  role: "expense_reporter",
};
const svetlana: Actor = {
  employeeId: "00000000-0000-4000-8000-000000000003",
  employeeCode: "svetlana",
  role: "manager",
};

const validSale: SaleSubmissionInput = {
  reference: "S99",
  customer: "Test Customer",
  project: "A",
  description: "Test wedding service",
  amountCents: 100_00,
  proposedSplit: { richard: 50, anastasia: 30, jeanClaude: 20 },
};

const validExpense: ExpenseSubmissionInput = {
  reference: "E99",
  description: "Test materials",
  category: "Materials",
  amountCents: 12_00,
  proposedAllocation: "A",
};

class MemoryRepository implements TransactionRepository {
  sales = new Map<string, PersistedSale>();
  expenses = new Map<string, PersistedExpense>();
  references = new Set<string>();
  nextId = 10;

  private id(): string {
    return `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`;
  }

  async getSaleAmountForApproval(transactionId: string): Promise<number> {
    const sale = this.sales.get(transactionId);
    if (!sale) throw new DomainError("TRANSACTION_NOT_FOUND", "Sale not found.");
    return sale.amountCents;
  }

  async createSale(
    actor: Actor,
    context: SubmissionContext,
    input: SaleSubmissionInput,
  ): Promise<PersistedSale> {
    const reference = input.reference.toUpperCase();
    if (this.references.has(reference)) {
      throw new DomainError("DUPLICATE_REFERENCE", "That transaction reference already exists.");
    }
    this.references.add(reference);
    const sale: PersistedSale = {
      transactionId: this.id(), reference, submittedByEmployeeId: actor.employeeId,
      origin: context.origin, originTelegramChatId: context.telegramChatId ?? null,
      customer: input.customer, project: input.project, description: input.description,
      amountCents: input.amountCents, proposedSplit: input.proposedSplit, finalSplit: null,
      status: "PENDING_APPROVAL", commission: null,
    };
    this.sales.set(sale.transactionId, sale);
    return sale;
  }

  async createExpense(
    actor: Actor,
    context: SubmissionContext,
    input: ExpenseSubmissionInput,
  ): Promise<PersistedExpense> {
    const reference = input.reference.toUpperCase();
    if (this.references.has(reference)) {
      throw new DomainError("DUPLICATE_REFERENCE", "That transaction reference already exists.");
    }
    this.references.add(reference);
    const overhead = input.proposedAllocation === "COMPANY_OVERHEAD";
    const expense: PersistedExpense = {
      transactionId: this.id(), reference, submittedByEmployeeId: actor.employeeId,
      origin: context.origin, originTelegramChatId: context.telegramChatId ?? null,
      description: input.description, category: input.category, amountCents: input.amountCents,
      proposedAllocation: input.proposedAllocation,
      finalAllocation: overhead ? "COMPANY_OVERHEAD" : null,
      status: overhead ? "ALLOCATED" : "AWAITING_ALLOCATION",
    };
    this.expenses.set(expense.transactionId, expense);
    return expense;
  }

  async approveSale(
    _manager: Actor,
    input: SaleApprovalInput,
    commission: CommissionAmounts,
  ): Promise<TransitionResult<PersistedSale>> {
    const sale = this.sales.get(input.transactionId);
    if (!sale) throw new DomainError("TRANSACTION_NOT_FOUND", "Sale not found.");
    if (sale.status === "APPROVED") return { record: sale, transitioned: false };
    const approved = { ...sale, status: "APPROVED" as const, finalSplit: input.finalSplit, commission };
    this.sales.set(input.transactionId, approved);
    return { record: approved, transitioned: true };
  }

  async allocateExpense(
    _manager: Actor,
    input: ExpenseAllocationInput,
  ): Promise<TransitionResult<PersistedExpense>> {
    const expense = this.expenses.get(input.transactionId);
    if (!expense) throw new DomainError("TRANSACTION_NOT_FOUND", "Expense not found.");
    if (expense.status === "ALLOCATED") return { record: expense, transitioned: false };
    const allocated = {
      ...expense,
      status: "ALLOCATED" as const,
      finalAllocation: input.finalAllocation,
    };
    this.expenses.set(input.transactionId, allocated);
    return { record: allocated, transitioned: true };
  }
}

class MemoryQueue implements SideEffectQueue {
  sheetJobs: string[] = [];
  notificationJobs: string[] = [];
  async queueSheetSync(transactionId: string): Promise<void> {
    this.sheetJobs.push(transactionId);
  }
  async queueNotification(input: { transactionId: string }): Promise<void> {
    this.notificationJobs.push(input.transactionId);
  }
}

function setup() {
  const repository = new MemoryRepository();
  const queue = new MemoryQueue();
  return { repository, queue, processor: new TransactionProcessor(repository, queue) };
}

describe("shared transaction processor", () => {
  it("allows a salesperson to submit a valid pending sale", async () => {
    const { processor } = setup();
    const sale = await processor.submitSale(richard, { origin: "website" }, validSale);
    expect(sale.status).toBe("PENDING_APPROVAL");
    expect(sale.finalSplit).toBeNull();
    expect(sale.commission).toBeNull();
  });

  it("prevents Kevin from submitting a sale", async () => {
    const { processor } = setup();
    await expect(processor.submitSale(kevin, { origin: "website" }, validSale)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("prevents a salesperson from submitting an expense", async () => {
    const { processor } = setup();
    await expect(processor.submitExpense(richard, { origin: "website" }, validExpense)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("allows Kevin to submit an expense awaiting allocation", async () => {
    const { processor } = setup();
    const expense = await processor.submitExpense(kevin, { origin: "website" }, validExpense);
    expect(expense.status).toBe("AWAITING_ALLOCATION");
    expect(expense.finalAllocation).toBeNull();
  });

  it("handles company overhead automatically", async () => {
    const { processor } = setup();
    const expense = await processor.submitExpense(kevin, { origin: "website" }, {
      ...validExpense,
      proposedAllocation: "COMPANY_OVERHEAD",
    });
    expect(expense.status).toBe("ALLOCATED");
    expect(expense.finalAllocation).toBe("COMPANY_OVERHEAD");
  });

  it("allows Svetlana to correct and approve a sale while preserving the proposal", async () => {
    const { processor } = setup();
    const sale = await processor.submitSale(richard, { origin: "website" }, validSale);
    const result = await processor.approveSale(svetlana, {
      transactionId: sale.transactionId,
      finalSplit: { richard: 40, anastasia: 30, jeanClaude: 30 },
    });
    expect(result.record.proposedSplit).toEqual(validSale.proposedSplit);
    expect(result.record.finalSplit).toEqual({ richard: 40, anastasia: 30, jeanClaude: 30 });
    expect(result.record.commission?.poolCents).toBe(1_000);
  });

  it("prevents a salesperson from approving a sale", async () => {
    const { processor } = setup();
    const sale = await processor.submitSale(richard, { origin: "website" }, validSale);
    await expect(processor.approveSale(richard, {
      transactionId: sale.transactionId,
      finalSplit: validSale.proposedSplit,
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("rejects duplicate references across transaction types", async () => {
    const { processor } = setup();
    await processor.submitSale(richard, { origin: "website" }, validSale);
    await expect(processor.submitExpense(kevin, { origin: "website" }, {
      ...validExpense,
      reference: validSale.reference.toLowerCase(),
    })).rejects.toMatchObject({ code: "DUPLICATE_REFERENCE" });
  });

  it("does not queue duplicate effects when a sale is approved twice", async () => {
    const { processor, queue } = setup();
    const sale = await processor.submitSale(richard, { origin: "website" }, validSale);
    const input = { transactionId: sale.transactionId, finalSplit: validSale.proposedSplit };
    await processor.approveSale(svetlana, input);
    await processor.approveSale(svetlana, input);
    expect(queue.sheetJobs).toHaveLength(2);
    expect(queue.notificationJobs).toHaveLength(1);
  });

  it("does not queue duplicate effects when an expense is allocated twice", async () => {
    const { processor, queue } = setup();
    const expense = await processor.submitExpense(kevin, { origin: "website" }, validExpense);
    const input = { transactionId: expense.transactionId, finalAllocation: "B" as const };
    await processor.allocateExpense(svetlana, input);
    await processor.allocateExpense(svetlana, input);
    expect(queue.sheetJobs).toHaveLength(2);
    expect(queue.notificationJobs).toHaveLength(1);
  });

  it("preserves the original employee and chat after the Telegram account is relinked", async () => {
    const { processor } = setup();
    const sale = await processor.submitSale(richard, {
      origin: "telegram",
      telegramUserId: "789",
      telegramChatId: "456",
    }, validSale);

    await processor.submitExpense(kevin, {
      origin: "telegram",
      telegramUserId: "789",
      telegramChatId: "456",
    }, validExpense);

    expect(sale.submittedByEmployeeId).toBe(richard.employeeId);
    expect(sale.originTelegramChatId).toBe("456");
  });

  it("keeps an approved financial decision when notification delivery fails", async () => {
    const repository = new MemoryRepository();
    const failedQueue: SideEffectQueue = {
      async queueSheetSync() {},
      async queueNotification() {
        // Production records FAILED and resolves; it does not roll back the decision.
      },
    };
    const processor = new TransactionProcessor(repository, failedQueue);
    const sale = await processor.submitSale(richard, { origin: "website" }, validSale);
    const result = await processor.approveSale(svetlana, {
      transactionId: sale.transactionId,
      finalSplit: validSale.proposedSplit,
    });

    expect(result.transitioned).toBe(true);
    expect(repository.sales.get(sale.transactionId)?.status).toBe("APPROVED");
  });
});
