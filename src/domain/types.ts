import type { EmployeeCode, EmployeeRole } from "./employees";

export type ProjectCode = "A" | "B";
export type ExpenseCategory = "Materials" | "Travel" | "Other";
export type AllocationTarget = ProjectCode | "COMPANY_OVERHEAD";
export type SubmissionOrigin = "website" | "telegram";
export type SaleStatus = "PENDING_APPROVAL" | "APPROVED";
export type ExpenseStatus = "AWAITING_ALLOCATION" | "ALLOCATED";

export interface Actor {
  employeeId: string;
  employeeCode: EmployeeCode;
  role: EmployeeRole;
}

export interface CommissionSplit {
  richard: number;
  anastasia: number;
  jeanClaude: number;
}

export interface CommissionAmounts {
  poolCents: number;
  richardCents: number;
  anastasiaCents: number;
  jeanClaudeCents: number;
}

export interface SubmissionContext {
  origin: SubmissionOrigin;
  telegramUserId?: string;
  telegramChatId?: string;
}

export interface SaleSubmissionInput {
  reference: string;
  customer: string;
  project: ProjectCode;
  description: string;
  amountCents: number;
  proposedSplit: CommissionSplit;
}

export interface ExpenseSubmissionInput {
  reference: string;
  description: string;
  category: ExpenseCategory;
  amountCents: number;
  proposedAllocation: AllocationTarget;
}

export interface SaleApprovalInput {
  transactionId: string;
  finalSplit: CommissionSplit;
}

export interface ExpenseAllocationInput {
  transactionId: string;
  finalAllocation: AllocationTarget;
}

export interface PersistedSale {
  transactionId: string;
  reference: string;
  submittedByEmployeeId: string;
  origin: SubmissionOrigin;
  originTelegramChatId: string | null;
  customer: string;
  project: ProjectCode;
  description: string;
  amountCents: number;
  proposedSplit: CommissionSplit;
  finalSplit: CommissionSplit | null;
  status: SaleStatus;
  commission: CommissionAmounts | null;
}

export interface PersistedExpense {
  transactionId: string;
  reference: string;
  submittedByEmployeeId: string;
  origin: SubmissionOrigin;
  originTelegramChatId: string | null;
  description: string;
  category: ExpenseCategory;
  amountCents: number;
  proposedAllocation: AllocationTarget;
  finalAllocation: AllocationTarget | null;
  status: ExpenseStatus;
}

export interface TransitionResult<T> {
  record: T;
  transitioned: boolean;
}
