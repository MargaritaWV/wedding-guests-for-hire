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
} from "@/src/domain/types";

export interface TransactionRepository {
  getSaleAmountForApproval(transactionId: string): Promise<number>;
  createSale(
    actor: Actor,
    context: SubmissionContext,
    input: SaleSubmissionInput,
  ): Promise<PersistedSale>;
  createExpense(
    actor: Actor,
    context: SubmissionContext,
    input: ExpenseSubmissionInput,
  ): Promise<PersistedExpense>;
  approveSale(
    manager: Actor,
    input: SaleApprovalInput,
    commission: CommissionAmounts,
  ): Promise<TransitionResult<PersistedSale>>;
  allocateExpense(
    manager: Actor,
    input: ExpenseAllocationInput,
  ): Promise<TransitionResult<PersistedExpense>>;
}

export type TransactionKind = "sale" | "expense";

export type NotificationKind =
  | "sale_submission_confirmation"
  | "expense_submission_confirmation"
  | "sale_approval_decision"
  | "expense_allocation_decision";

export interface SideEffectQueue {
  queueSheetSync(transactionId: string, kind: TransactionKind): Promise<void>;
  queueNotification(input: {
    transactionId: string;
    kind: NotificationKind;
    fixedDestinationChatId: string | null;
    fallbackEmployeeId: string | null;
  }): Promise<void>;
}
