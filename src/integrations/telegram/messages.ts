import { formatEuro } from "@/src/domain/money";
import type { AllocationTarget, CommissionAmounts, CommissionSplit } from "@/src/domain/types";

function allocationLabel(value: AllocationTarget): string {
  if (value === "COMPANY_OVERHEAD") return "Company overhead";
  return `Project ${value}`;
}

export function formatSaleSubmissionMessage(input: {
  reference: string;
  amountCents: number;
  project: "A" | "B";
}): string {
  return [
    `Sale ${input.reference} recorded.`,
    `Amount: ${formatEuro(input.amountCents)}`,
    `Project: ${input.project}`,
    "Status: Pending approval",
  ].join("\n");
}

export function formatExpenseSubmissionMessage(input: {
  reference: string;
  amountCents: number;
  proposedAllocation: AllocationTarget;
  finalAllocation: AllocationTarget | null;
  status: "AWAITING_ALLOCATION" | "ALLOCATED";
}): string {
  return [
    `Expense ${input.reference} recorded.`,
    `Amount: ${formatEuro(input.amountCents)}`,
    `Proposed allocation: ${allocationLabel(input.proposedAllocation)}`,
    ...(input.finalAllocation
      ? [`Final allocation: ${allocationLabel(input.finalAllocation)}`]
      : []),
    `Status: ${input.status === "ALLOCATED" ? "Allocated" : "Awaiting allocation"}`,
  ].join("\n");
}

export function formatSaleDecisionMessage(input: {
  reference: string;
  amountCents: number;
  proposedSplit: CommissionSplit;
  finalSplit: CommissionSplit;
  commission: CommissionAmounts;
  managerChangedSplit: boolean;
}): string {
  const change = input.managerChangedSplit ? "commission split changed" : "commission split approved";
  const share = (
    name: string,
    proposed: number,
    final: number,
    amountCents: number,
  ) => `${name}: ${input.managerChangedSplit ? `${proposed}% → ` : ""}${final}% (${formatEuro(amountCents)})`;
  return [
    `Sale ${input.reference} approved — ${change}.`,
    `Sale amount: ${formatEuro(input.amountCents)}`,
    `Total commission: ${formatEuro(input.commission.poolCents)}`,
    share("Richard", input.proposedSplit.richard, input.finalSplit.richard, input.commission.richardCents),
    share("Anastasia", input.proposedSplit.anastasia, input.finalSplit.anastasia, input.commission.anastasiaCents),
    share("Jean-Claude", input.proposedSplit.jeanClaude, input.finalSplit.jeanClaude, input.commission.jeanClaudeCents),
  ].join("\n");
}

export function formatExpenseDecisionMessage(input: {
  reference: string;
  amountCents: number;
  description: string;
  proposedAllocation: AllocationTarget;
  finalAllocation: AllocationTarget;
  managerChangedAllocation: boolean;
}): string {
  return [
    `Expense ${input.reference} — allocation ${input.managerChangedAllocation ? "changed" : "approved"}.`,
    `${formatEuro(input.amountCents)}: ${input.description}`,
    ...(input.managerChangedAllocation
      ? [
          `Proposed: ${allocationLabel(input.proposedAllocation)}`,
          `Approved: ${allocationLabel(input.finalAllocation)}`,
        ]
      : [`Final allocation: ${allocationLabel(input.finalAllocation)}`]),
  ].join("\n");
}

export function selectNotificationDestination(input: {
  origin: "website" | "telegram";
  originalTelegramChatId: string | null;
  currentEmployeeLinkedChatId: string | null;
}): string | null {
  return input.origin === "telegram"
    ? input.originalTelegramChatId
    : input.currentEmployeeLinkedChatId;
}
