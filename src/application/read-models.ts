import type { EmployeeCode, EmployeeRole } from "@/src/domain/employees";
import type {
  AllocationTarget,
  CommissionAmounts,
  CommissionSplit,
  ExpenseCategory,
  ExpenseStatus,
  ProjectCode,
  SaleStatus,
  SubmissionOrigin,
} from "@/src/domain/types";

export interface EmployeeRecord {
  id: string;
  code: EmployeeCode;
  displayName: string;
  role: EmployeeRole;
}

export interface DeliveryView {
  sheetState: "PENDING" | "SYNCED" | "FAILED" | "NOT_CONFIGURED";
  sheetMessage: string;
  notificationState: "PENDING" | "SENT" | "FAILED" | "NOT_REQUIRED" | "NONE";
  notificationMessage: string;
  notificationKind:
    | "SALE_SUBMISSION_CONFIRMATION"
    | "EXPENSE_SUBMISSION_CONFIRMATION"
    | "SALE_APPROVAL_DECISION"
    | "EXPENSE_ALLOCATION_DECISION"
    | null;
}

export interface TelegramLinkView {
  telegramUserId: string;
  employeeCode: EmployeeCode;
  employeeName: string;
  hasPrivateChat: boolean;
  updatedAt: string;
}

export interface SaleRecordView extends DeliveryView {
  transactionId: string;
  reference: string;
  submittedAt: string;
  submittedByEmployeeId: string;
  submitterCode: EmployeeCode;
  submitterName: string;
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
  managerChangedSplit: boolean;
  approvedAt: string | null;
}

export interface ExpenseRecordView extends DeliveryView {
  transactionId: string;
  reference: string;
  submittedAt: string;
  submittedByEmployeeId: string;
  submitterCode: EmployeeCode;
  submitterName: string;
  origin: SubmissionOrigin;
  originTelegramChatId: string | null;
  description: string;
  category: ExpenseCategory;
  amountCents: number;
  proposedAllocation: AllocationTarget;
  finalAllocation: AllocationTarget | null;
  status: ExpenseStatus;
  allocationWasAutomatic: boolean;
  managerChangedAllocation: boolean;
  allocatedAt: string | null;
}

export interface FinanceSnapshot {
  sales: SaleRecordView[];
  expenses: ExpenseRecordView[];
}
