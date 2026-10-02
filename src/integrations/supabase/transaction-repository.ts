import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DeliveryView,
  ExpenseRecordView,
  FinanceSnapshot,
  SaleRecordView,
} from "@/src/application/read-models";
import type { TransactionRepository } from "@/src/application/ports";
import { DomainError } from "@/src/domain/errors";
import type { EmployeeCode, EmployeeRole } from "@/src/domain/employees";
import type {
  Actor,
  AllocationTarget,
  CommissionAmounts,
  CommissionSplit,
  ExpenseAllocationInput,
  ExpenseSubmissionInput,
  PersistedExpense,
  PersistedSale,
  SaleApprovalInput,
  SaleSubmissionInput,
  SubmissionContext,
  TransitionResult,
} from "@/src/domain/types";

type DbRow = Record<string, unknown>;

function numberValue(value: unknown): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new DomainError("PERSISTENCE_FAILED", "The database returned an invalid money value.");
  }
  return result;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function normalizeReference(value: string): string {
  return value.trim().toUpperCase();
}

function persistenceError(message: string, details?: unknown): DomainError {
  return new DomainError("PERSISTENCE_FAILED", message, details);
}

function mapSale(transaction: DbRow, sale: DbRow): PersistedSale {
  const approved = sale.status === "APPROVED";
  return {
    transactionId: String(transaction.id),
    reference: String(transaction.reference),
    submittedByEmployeeId: String(transaction.submitted_by_employee_id),
    origin: transaction.origin as PersistedSale["origin"],
    originTelegramChatId: nullableString(transaction.origin_telegram_chat_id),
    customer: String(sale.customer),
    project: sale.project as PersistedSale["project"],
    description: String(sale.description),
    amountCents: numberValue(sale.amount_cents),
    proposedSplit: {
      richard: numberValue(sale.proposed_richard_percent),
      anastasia: numberValue(sale.proposed_anastasia_percent),
      jeanClaude: numberValue(sale.proposed_jean_claude_percent),
    },
    finalSplit: approved
      ? {
          richard: numberValue(sale.final_richard_percent),
          anastasia: numberValue(sale.final_anastasia_percent),
          jeanClaude: numberValue(sale.final_jean_claude_percent),
        }
      : null,
    status: sale.status as PersistedSale["status"],
    commission: approved
      ? {
          poolCents: numberValue(sale.commission_pool_cents),
          richardCents: numberValue(sale.richard_commission_cents),
          anastasiaCents: numberValue(sale.anastasia_commission_cents),
          jeanClaudeCents: numberValue(sale.jean_claude_commission_cents),
        }
      : null,
  };
}

function mapExpense(transaction: DbRow, expense: DbRow): PersistedExpense {
  return {
    transactionId: String(transaction.id),
    reference: String(transaction.reference),
    submittedByEmployeeId: String(transaction.submitted_by_employee_id),
    origin: transaction.origin as PersistedExpense["origin"],
    originTelegramChatId: nullableString(transaction.origin_telegram_chat_id),
    description: String(expense.description),
    category: expense.category as PersistedExpense["category"],
    amountCents: numberValue(expense.amount_cents),
    proposedAllocation: expense.proposed_allocation as AllocationTarget,
    finalAllocation: (expense.final_allocation as AllocationTarget | null) ?? null,
    status: expense.status as PersistedExpense["status"],
  };
}

export class SupabaseTransactionRepository implements TransactionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async resolveActor(code: EmployeeCode): Promise<Actor> {
    const { data, error } = await this.client
      .from("employees")
      .select("id,code,role,active")
      .eq("code", code)
      .eq("active", true)
      .single();
    if (error || !data) {
      throw persistenceError("The selected demonstration employee is not available.", error);
    }
    return {
      employeeId: String(data.id),
      employeeCode: data.code as EmployeeCode,
      role: data.role as EmployeeRole,
    };
  }

  async verifyConnection(): Promise<void> {
    const { error, count } = await this.client
      .from("employees")
      .select("id", { count: "exact", head: true });
    if (error || count !== 5) {
      throw persistenceError("Supabase is configured but the employee table could not be verified.", error);
    }
  }

  async getSaleAmountForApproval(transactionId: string): Promise<number> {
    const { data, error } = await this.client
      .from("sales")
      .select("amount_cents")
      .eq("transaction_id", transactionId)
      .maybeSingle();
    if (error) throw persistenceError("The sale could not be loaded for approval.", error);
    if (!data) throw new DomainError("TRANSACTION_NOT_FOUND", "The sale no longer exists.");
    return numberValue(data.amount_cents);
  }

  async createSale(
    actor: Actor,
    context: SubmissionContext,
    input: SaleSubmissionInput,
  ): Promise<PersistedSale> {
    const transaction = await this.insertTransaction(actor, context, input.reference, "sale");
    const { data, error } = await this.client
      .from("sales")
      .insert({
        transaction_id: transaction.id,
        customer: input.customer,
        project: input.project,
        description: input.description,
        amount_cents: input.amountCents,
        proposed_richard_percent: input.proposedSplit.richard,
        proposed_anastasia_percent: input.proposedSplit.anastasia,
        proposed_jean_claude_percent: input.proposedSplit.jeanClaude,
        status: "PENDING_APPROVAL",
      })
      .select("*")
      .single();
    if (error || !data) {
      await this.deleteIncompleteTransaction(String(transaction.id));
      throw persistenceError("The sale could not be saved. No partial sale was kept.", error);
    }
    return mapSale(transaction, data as DbRow);
  }

  async createExpense(
    actor: Actor,
    context: SubmissionContext,
    input: ExpenseSubmissionInput,
  ): Promise<PersistedExpense> {
    const transaction = await this.insertTransaction(actor, context, input.reference, "expense");
    const overhead = input.proposedAllocation === "COMPANY_OVERHEAD";
    const now = overhead ? new Date().toISOString() : null;
    const { data, error } = await this.client
      .from("expenses")
      .insert({
        transaction_id: transaction.id,
        description: input.description,
        category: input.category,
        amount_cents: input.amountCents,
        proposed_allocation: input.proposedAllocation,
        final_allocation: overhead ? "COMPANY_OVERHEAD" : null,
        status: overhead ? "ALLOCATED" : "AWAITING_ALLOCATION",
        allocated_at: now,
        allocation_was_automatic: overhead,
      })
      .select("*")
      .single();
    if (error || !data) {
      await this.deleteIncompleteTransaction(String(transaction.id));
      throw persistenceError("The expense could not be saved. No partial expense was kept.", error);
    }
    return mapExpense(transaction, data as DbRow);
  }

  async approveSale(
    manager: Actor,
    input: SaleApprovalInput,
    commission: CommissionAmounts,
  ): Promise<TransitionResult<PersistedSale>> {
    const before = await this.loadSale(input.transactionId);
    if (before.sale.status === "APPROVED") {
      return { record: mapSale(before.transaction, before.sale), transitioned: false };
    }

    const proposed: CommissionSplit = {
      richard: numberValue(before.sale.proposed_richard_percent),
      anastasia: numberValue(before.sale.proposed_anastasia_percent),
      jeanClaude: numberValue(before.sale.proposed_jean_claude_percent),
    };
    const changed =
      proposed.richard !== input.finalSplit.richard ||
      proposed.anastasia !== input.finalSplit.anastasia ||
      proposed.jeanClaude !== input.finalSplit.jeanClaude;
    const approvedAt = new Date().toISOString();
    const { data, error } = await this.client
      .from("sales")
      .update({
        final_richard_percent: input.finalSplit.richard,
        final_anastasia_percent: input.finalSplit.anastasia,
        final_jean_claude_percent: input.finalSplit.jeanClaude,
        status: "APPROVED",
        commission_pool_cents: commission.poolCents,
        richard_commission_cents: commission.richardCents,
        anastasia_commission_cents: commission.anastasiaCents,
        jean_claude_commission_cents: commission.jeanClaudeCents,
        approved_by_employee_id: manager.employeeId,
        approved_at: approvedAt,
        manager_changed_split: changed,
      })
      .eq("transaction_id", input.transactionId)
      .eq("status", "PENDING_APPROVAL")
      .select("*")
      .maybeSingle();
    if (error) throw persistenceError("The sale approval could not be saved.", error);
    if (!data) {
      const current = await this.loadSale(input.transactionId);
      return { record: mapSale(current.transaction, current.sale), transitioned: false };
    }

    const { error: decisionError } = await this.client.from("manager_decisions").upsert(
      {
        transaction_id: input.transactionId,
        kind: "SALE_APPROVAL",
        manager_employee_id: manager.employeeId,
        original_proposal: proposed,
        final_decision: input.finalSplit,
        manager_changed_proposal: changed,
        decided_at: approvedAt,
      },
      { onConflict: "transaction_id", ignoreDuplicates: true },
    );
    if (decisionError) {
      throw persistenceError("The sale was approved, but its decision audit could not be saved.", decisionError);
    }
    return { record: mapSale(before.transaction, data as DbRow), transitioned: true };
  }

  async allocateExpense(
    manager: Actor,
    input: ExpenseAllocationInput,
  ): Promise<TransitionResult<PersistedExpense>> {
    const before = await this.loadExpense(input.transactionId);
    if (before.expense.status === "ALLOCATED") {
      return { record: mapExpense(before.transaction, before.expense), transitioned: false };
    }

    const proposed = before.expense.proposed_allocation as AllocationTarget;
    const changed = proposed !== input.finalAllocation;
    const allocatedAt = new Date().toISOString();
    const { data, error } = await this.client
      .from("expenses")
      .update({
        final_allocation: input.finalAllocation,
        status: "ALLOCATED",
        allocated_by_employee_id: manager.employeeId,
        allocated_at: allocatedAt,
        allocation_was_automatic: false,
        manager_changed_allocation: changed,
      })
      .eq("transaction_id", input.transactionId)
      .eq("status", "AWAITING_ALLOCATION")
      .select("*")
      .maybeSingle();
    if (error) throw persistenceError("The expense allocation could not be saved.", error);
    if (!data) {
      const current = await this.loadExpense(input.transactionId);
      return { record: mapExpense(current.transaction, current.expense), transitioned: false };
    }

    const { error: decisionError } = await this.client.from("manager_decisions").upsert(
      {
        transaction_id: input.transactionId,
        kind: "EXPENSE_ALLOCATION",
        manager_employee_id: manager.employeeId,
        original_proposal: { allocation: proposed },
        final_decision: { allocation: input.finalAllocation },
        manager_changed_proposal: changed,
        decided_at: allocatedAt,
      },
      { onConflict: "transaction_id", ignoreDuplicates: true },
    );
    if (decisionError) {
      throw persistenceError("The expense was allocated, but its decision audit could not be saved.", decisionError);
    }
    return { record: mapExpense(before.transaction, data as DbRow), transitioned: true };
  }

  async getSnapshot(viewer: Actor): Promise<FinanceSnapshot> {
    let transactionQuery = this.client.from("transactions").select("*").order("submitted_at", {
      ascending: false,
    });
    if (viewer.role !== "manager") {
      transactionQuery = transactionQuery.eq("submitted_by_employee_id", viewer.employeeId);
    }
    const { data: transactionData, error: transactionError } = await transactionQuery;
    if (transactionError) throw persistenceError("Transactions could not be loaded.", transactionError);
    const transactions = (transactionData ?? []) as DbRow[];
    if (transactions.length === 0) return { sales: [], expenses: [] };

    const transactionIds = transactions.map((transaction) => String(transaction.id));
    const [employeesResult, salesResult, expensesResult, syncResult, notificationsResult] =
      await Promise.all([
        this.client.from("employees").select("id,code,display_name,role"),
        this.client.from("sales").select("*").in("transaction_id", transactionIds),
        this.client.from("expenses").select("*").in("transaction_id", transactionIds),
        this.client.from("google_sheet_sync_jobs").select("*").in("transaction_id", transactionIds),
        this.client
          .from("notification_jobs")
          .select("*")
          .in("transaction_id", transactionIds)
          .order("created_at", { ascending: false }),
      ]);
    for (const result of [employeesResult, salesResult, expensesResult, syncResult, notificationsResult]) {
      if (result.error) throw persistenceError("Financial records could not be loaded.", result.error);
    }

    const employees = new Map(
      ((employeesResult.data ?? []) as DbRow[]).map((row) => [String(row.id), row]),
    );
    const sales = new Map(
      ((salesResult.data ?? []) as DbRow[]).map((row) => [String(row.transaction_id), row]),
    );
    const expenses = new Map(
      ((expensesResult.data ?? []) as DbRow[]).map((row) => [String(row.transaction_id), row]),
    );
    const syncJobs = new Map(
      ((syncResult.data ?? []) as DbRow[]).map((row) => [String(row.transaction_id), row]),
    );
    const notifications = new Map<string, DbRow>();
    for (const row of (notificationsResult.data ?? []) as DbRow[]) {
      const id = String(row.transaction_id);
      if (!notifications.has(id)) notifications.set(id, row);
    }

    const saleViews: SaleRecordView[] = [];
    const expenseViews: ExpenseRecordView[] = [];
    for (const transaction of transactions) {
      const transactionId = String(transaction.id);
      const employee = employees.get(String(transaction.submitted_by_employee_id));
      if (!employee) throw persistenceError("A transaction refers to a missing employee.");
      const delivery = this.deliveryView(syncJobs.get(transactionId), notifications.get(transactionId));
      const base = {
        transactionId,
        reference: String(transaction.reference),
        submittedAt: String(transaction.submitted_at),
        submittedByEmployeeId: String(transaction.submitted_by_employee_id),
        submitterCode: employee.code as EmployeeCode,
        submitterName: String(employee.display_name),
        origin: transaction.origin as SaleRecordView["origin"],
        originTelegramChatId: nullableString(transaction.origin_telegram_chat_id),
        ...delivery,
      };

      const sale = sales.get(transactionId);
      if (sale) {
        const mapped = mapSale(transaction, sale);
        saleViews.push({
          ...base,
          customer: mapped.customer,
          project: mapped.project,
          description: mapped.description,
          amountCents: mapped.amountCents,
          proposedSplit: mapped.proposedSplit,
          finalSplit: mapped.finalSplit,
          status: mapped.status,
          commission: mapped.commission,
          managerChangedSplit: Boolean(sale.manager_changed_split),
          approvedAt: nullableString(sale.approved_at),
        });
      }

      const expense = expenses.get(transactionId);
      if (expense) {
        const mapped = mapExpense(transaction, expense);
        expenseViews.push({
          ...base,
          description: mapped.description,
          category: mapped.category,
          amountCents: mapped.amountCents,
          proposedAllocation: mapped.proposedAllocation,
          finalAllocation: mapped.finalAllocation,
          status: mapped.status,
          allocationWasAutomatic: Boolean(expense.allocation_was_automatic),
          managerChangedAllocation: Boolean(expense.manager_changed_allocation),
          allocatedAt: nullableString(expense.allocated_at),
        });
      }
    }
    return { sales: saleViews, expenses: expenseViews };
  }

  private async insertTransaction(
    actor: Actor,
    context: SubmissionContext,
    reference: string,
    kind: "sale" | "expense",
  ): Promise<DbRow> {
    const { data, error } = await this.client
      .from("transactions")
      .insert({
        reference: normalizeReference(reference),
        kind,
        submitted_by_employee_id: actor.employeeId,
        origin: context.origin,
        origin_telegram_user_id: context.telegramUserId ?? null,
        origin_telegram_chat_id: context.telegramChatId ?? null,
      })
      .select("*")
      .single();
    if (error?.code === "23505") {
      throw new DomainError("DUPLICATE_REFERENCE", "That transaction reference already exists.");
    }
    if (error || !data) throw persistenceError("The transaction could not be saved.", error);
    return data as DbRow;
  }

  private async deleteIncompleteTransaction(transactionId: string): Promise<void> {
    await this.client.from("transactions").delete().eq("id", transactionId);
  }

  private async loadSale(transactionId: string): Promise<{ transaction: DbRow; sale: DbRow }> {
    const [transactionResult, saleResult] = await Promise.all([
      this.client.from("transactions").select("*").eq("id", transactionId).maybeSingle(),
      this.client.from("sales").select("*").eq("transaction_id", transactionId).maybeSingle(),
    ]);
    if (transactionResult.error || saleResult.error) {
      throw persistenceError("The sale could not be loaded.", transactionResult.error ?? saleResult.error);
    }
    if (!transactionResult.data || !saleResult.data) {
      throw new DomainError("TRANSACTION_NOT_FOUND", "The sale no longer exists.");
    }
    return { transaction: transactionResult.data as DbRow, sale: saleResult.data as DbRow };
  }

  private async loadExpense(
    transactionId: string,
  ): Promise<{ transaction: DbRow; expense: DbRow }> {
    const [transactionResult, expenseResult] = await Promise.all([
      this.client.from("transactions").select("*").eq("id", transactionId).maybeSingle(),
      this.client.from("expenses").select("*").eq("transaction_id", transactionId).maybeSingle(),
    ]);
    if (transactionResult.error || expenseResult.error) {
      throw persistenceError(
        "The expense could not be loaded.",
        transactionResult.error ?? expenseResult.error,
      );
    }
    if (!transactionResult.data || !expenseResult.data) {
      throw new DomainError("TRANSACTION_NOT_FOUND", "The expense no longer exists.");
    }
    return { transaction: transactionResult.data as DbRow, expense: expenseResult.data as DbRow };
  }

  private deliveryView(syncJob?: DbRow, notification?: DbRow): DeliveryView {
    const sheetState = syncJob
      ? (syncJob.state as "PENDING" | "SYNCED" | "FAILED")
      : "NOT_CONFIGURED";
    const sheetMessage =
      sheetState === "SYNCED"
        ? "Synchronized"
        : sheetState === "FAILED"
          ? "Sync failed"
          : sheetState === "PENDING" && String(syncJob?.last_error ?? "").includes("not configured")
            ? "Synchronization not configured"
            : sheetState === "PENDING"
              ? "Sync pending"
              : "Synchronization not configured";
    const notificationState = notification
      ? (notification.state as "PENDING" | "SENT" | "FAILED" | "NOT_REQUIRED")
      : "NONE";
    const notificationMessage =
      notificationState === "SENT"
        ? "Notification sent"
        : notificationState === "FAILED"
          ? "Notification failed"
          : notificationState === "PENDING"
            ? "Telegram delivery not configured"
            : notificationState === "NOT_REQUIRED"
              ? String(notification?.not_required_reason ?? "No notification required")
              : "No decision notification yet";
    const notificationKind = notification
      ? (notification.kind as DeliveryView["notificationKind"])
      : null;
    return { sheetState, sheetMessage, notificationState, notificationMessage, notificationKind };
  }
}
