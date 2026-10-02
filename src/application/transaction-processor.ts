import type { SideEffectQueue, TransactionRepository } from "./ports";
import { calculateCommission } from "@/src/domain/commissions";
import { assertCanPerform } from "@/src/domain/permissions";
import type {
  Actor,
  ExpenseAllocationInput,
  ExpenseSubmissionInput,
  PersistedExpense,
  PersistedSale,
  SaleApprovalInput,
  SaleSubmissionInput,
  SubmissionContext,
  TransitionResult,
} from "@/src/domain/types";
import {
  expenseAllocationSchema,
  expenseSubmissionSchema,
  saleApprovalSchema,
  saleSubmissionSchema,
} from "@/src/domain/validation";

/**
 * This is the single application service for both website routes and Telegram handlers.
 * Adapters identify the actor, normalize the input, and call these methods. They must not
 * reimplement permissions, validation, commission calculations, or approval behavior.
 */
export class TransactionProcessor {
  constructor(
    private readonly repository: TransactionRepository,
    private readonly sideEffects: SideEffectQueue,
  ) {}

  async submitSale(
    actor: Actor,
    context: SubmissionContext,
    rawInput: SaleSubmissionInput,
  ): Promise<PersistedSale> {
    assertCanPerform(actor.role, "submit_sale");
    const input = saleSubmissionSchema.parse(rawInput);
    const sale = await this.repository.createSale(actor, context, input);

    await this.sideEffects.queueSheetSync(sale.transactionId, "sale");
    if (context.origin === "telegram" && sale.originTelegramChatId) {
      await this.sideEffects.queueNotification({
        transactionId: sale.transactionId,
        kind: "sale_submission_confirmation",
        fixedDestinationChatId: sale.originTelegramChatId,
        fallbackEmployeeId: null,
      });
    }
    return sale;
  }

  async submitExpense(
    actor: Actor,
    context: SubmissionContext,
    rawInput: ExpenseSubmissionInput,
  ): Promise<PersistedExpense> {
    assertCanPerform(actor.role, "submit_expense");
    const input = expenseSubmissionSchema.parse(rawInput);
    const expense = await this.repository.createExpense(actor, context, input);

    await this.sideEffects.queueSheetSync(expense.transactionId, "expense");
    if (context.origin === "telegram" && expense.originTelegramChatId) {
      await this.sideEffects.queueNotification({
        transactionId: expense.transactionId,
        kind: "expense_submission_confirmation",
        fixedDestinationChatId: expense.originTelegramChatId,
        fallbackEmployeeId: null,
      });
    }
    return expense;
  }

  async approveSale(
    actor: Actor,
    rawInput: SaleApprovalInput,
  ): Promise<TransitionResult<PersistedSale>> {
    assertCanPerform(actor.role, "make_manager_decision");
    const input = saleApprovalSchema.parse(rawInput);

    // The repository performs a conditional, atomic transition. If already approved,
    // transitioned is false and no duplicate sync or notification job is created.
    const existingAmountCents = await this.repository.getSaleAmountForApproval(input.transactionId);
    const commission = calculateCommission(existingAmountCents, input.finalSplit);
    const result = await this.repository.approveSale(actor, input, commission);

    if (result.transitioned) {
      await this.sideEffects.queueSheetSync(result.record.transactionId, "sale");
      await this.sideEffects.queueNotification({
        transactionId: result.record.transactionId,
        kind: "sale_approval_decision",
        fixedDestinationChatId: result.record.originTelegramChatId,
        fallbackEmployeeId: result.record.origin === "website" ? result.record.submittedByEmployeeId : null,
      });
    }
    return result;
  }

  async allocateExpense(
    actor: Actor,
    rawInput: ExpenseAllocationInput,
  ): Promise<TransitionResult<PersistedExpense>> {
    assertCanPerform(actor.role, "make_manager_decision");
    const input = expenseAllocationSchema.parse(rawInput);
    const result = await this.repository.allocateExpense(actor, input);

    if (result.transitioned) {
      await this.sideEffects.queueSheetSync(result.record.transactionId, "expense");
      await this.sideEffects.queueNotification({
        transactionId: result.record.transactionId,
        kind: "expense_allocation_decision",
        fixedDestinationChatId: result.record.originTelegramChatId,
        fallbackEmployeeId: result.record.origin === "website" ? result.record.submittedByEmployeeId : null,
      });
    }
    return result;
  }

}
