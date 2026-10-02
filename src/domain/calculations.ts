import type {
  AllocationTarget,
  CommissionAmounts,
  ExpenseStatus,
  ProjectCode,
  SaleStatus,
} from "./types";

export interface FinancialSale {
  project: ProjectCode;
  amountCents: number;
  status: SaleStatus;
  commission: CommissionAmounts | null;
}

export interface FinancialExpense {
  amountCents: number;
  status: ExpenseStatus;
  finalAllocation: AllocationTarget | null;
}

export interface ProjectResult {
  approvedIncomeCents: number;
  commissionExpenseCents: number;
  allocatedExpenseCents: number;
  resultCents: number;
}

export interface FinancialSummary {
  projects: Record<ProjectCode, ProjectResult>;
  approvedSalesCents: number;
  totalCommissionExpenseCents: number;
  allRecordedExpensesCents: number;
  companyOverheadCents: number;
  awaitingAllocationCents: number;
  totalCompanyResultCents: number;
  individualCommissionCents: {
    richard: number;
    anastasia: number;
    jeanClaude: number;
  };
}

function emptyProject(): ProjectResult {
  return {
    approvedIncomeCents: 0,
    commissionExpenseCents: 0,
    allocatedExpenseCents: 0,
    resultCents: 0,
  };
}

export function calculateFinancialSummary(
  sales: readonly FinancialSale[],
  expenses: readonly FinancialExpense[],
): FinancialSummary {
  const projects: Record<ProjectCode, ProjectResult> = {
    A: emptyProject(),
    B: emptyProject(),
  };
  const individualCommissionCents = { richard: 0, anastasia: 0, jeanClaude: 0 };

  for (const sale of sales) {
    if (sale.status !== "APPROVED" || !sale.commission) continue;
    const project = projects[sale.project];
    project.approvedIncomeCents += sale.amountCents;
    project.commissionExpenseCents += sale.commission.poolCents;
    individualCommissionCents.richard += sale.commission.richardCents;
    individualCommissionCents.anastasia += sale.commission.anastasiaCents;
    individualCommissionCents.jeanClaude += sale.commission.jeanClaudeCents;
  }

  let companyOverheadCents = 0;
  let awaitingAllocationCents = 0;
  let allRecordedExpenseCents = 0;

  for (const expense of expenses) {
    allRecordedExpenseCents += expense.amountCents;
    if (expense.status === "AWAITING_ALLOCATION") {
      awaitingAllocationCents += expense.amountCents;
    } else if (expense.finalAllocation === "COMPANY_OVERHEAD") {
      companyOverheadCents += expense.amountCents;
    } else if (expense.finalAllocation === "A" || expense.finalAllocation === "B") {
      projects[expense.finalAllocation].allocatedExpenseCents += expense.amountCents;
    }
  }

  for (const project of Object.values(projects)) {
    project.resultCents =
      project.approvedIncomeCents -
      project.commissionExpenseCents -
      project.allocatedExpenseCents;
  }

  const approvedSalesCents =
    projects.A.approvedIncomeCents + projects.B.approvedIncomeCents;
  const totalCommissionCents =
    projects.A.commissionExpenseCents + projects.B.commissionExpenseCents;

  return {
    projects,
    approvedSalesCents,
    totalCommissionExpenseCents: totalCommissionCents,
    allRecordedExpensesCents: allRecordedExpenseCents,
    companyOverheadCents,
    awaitingAllocationCents,
    totalCompanyResultCents:
      approvedSalesCents - totalCommissionCents - allRecordedExpenseCents,
    individualCommissionCents,
  };
}
