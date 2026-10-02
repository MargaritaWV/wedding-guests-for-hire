import type { SheetRow } from "./gateway";
import type { AllocationTarget, CommissionAmounts, CommissionSplit } from "@/src/domain/types";

export interface SaleSheetRecord {
  reference: string;
  submittedAt: string;
  salesperson: string;
  customer: string;
  project: "A" | "B";
  description: string;
  amountCents: number;
  proposedSplit: CommissionSplit;
  finalSplit: CommissionSplit | null;
  commission: CommissionAmounts | null;
  status: "PENDING_APPROVAL" | "APPROVED";
}

export interface ExpenseSheetRecord {
  reference: string;
  submittedAt: string;
  reporter: string;
  description: string;
  category: "Materials" | "Travel" | "Other";
  amountCents: number;
  proposedAllocation: AllocationTarget;
  finalAllocation: AllocationTarget | null;
  status: "AWAITING_ALLOCATION" | "ALLOCATED";
}

function euros(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

function allocation(value: AllocationTarget | null): string {
  if (!value) return "";
  return value === "COMPANY_OVERHEAD" ? "Company overhead" : `Project ${value}`;
}

export function serializeSaleRow(record: SaleSheetRecord): SheetRow {
  const final = record.finalSplit;
  const commission = record.commission;
  return {
    reference: record.reference,
    values: [
      record.reference,
      new Date(record.submittedAt).toISOString(),
      record.salesperson,
      record.customer,
      `Project ${record.project}`,
      record.description,
      euros(record.amountCents),
      record.proposedSplit.richard,
      record.proposedSplit.anastasia,
      record.proposedSplit.jeanClaude,
      final?.richard ?? "",
      final?.anastasia ?? "",
      final?.jeanClaude ?? "",
      euros(commission?.richardCents ?? 0),
      euros(commission?.anastasiaCents ?? 0),
      euros(commission?.jeanClaudeCents ?? 0),
      record.status === "APPROVED" ? "Approved" : "Pending approval",
    ],
  };
}

export function serializeExpenseRow(record: ExpenseSheetRecord): SheetRow {
  return {
    reference: record.reference,
    values: [
      record.reference,
      new Date(record.submittedAt).toISOString(),
      record.reporter,
      record.description,
      record.category,
      euros(record.amountCents),
      allocation(record.proposedAllocation),
      allocation(record.finalAllocation),
      record.status === "ALLOCATED" ? "Allocated" : "Awaiting allocation",
    ],
  };
}
