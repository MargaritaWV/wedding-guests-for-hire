import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationKind, SideEffectQueue, TransactionKind } from "@/src/application/ports";
import { DomainError } from "@/src/domain/errors";
import type { Actor, AllocationTarget, CommissionSplit } from "@/src/domain/types";
import { assertCanPerform } from "@/src/domain/permissions";
import type { GoogleSheetsGateway, SheetRow, SheetTab } from "@/src/integrations/google-sheets/gateway";
import { safeGoogleSheetsError } from "@/src/integrations/google-sheets/gateway";
import { serializeExpenseRow, serializeSaleRow } from "@/src/integrations/google-sheets/rows";
import type { TelegramGateway } from "@/src/integrations/telegram/client";
import {
  formatExpenseDecisionMessage,
  formatExpenseSubmissionMessage,
  formatSaleDecisionMessage,
  formatSaleSubmissionMessage,
  selectNotificationDestination,
} from "@/src/integrations/telegram/messages";

type DbRow = Record<string, unknown>;

export type DatabaseNotificationKind =
  | "SALE_SUBMISSION_CONFIRMATION"
  | "EXPENSE_SUBMISSION_CONFIRMATION"
  | "SALE_APPROVAL_DECISION"
  | "EXPENSE_ALLOCATION_DECISION";

const notificationKinds: Record<NotificationKind, DatabaseNotificationKind> = {
  sale_submission_confirmation: "SALE_SUBMISSION_CONFIRMATION",
  expense_submission_confirmation: "EXPENSE_SUBMISSION_CONFIRMATION",
  sale_approval_decision: "SALE_APPROVAL_DECISION",
  expense_allocation_decision: "EXPENSE_ALLOCATION_DECISION",
};

function integer(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new DomainError("PERSISTENCE_FAILED", "The database returned invalid notification data.");
  }
  return result;
}

function nullableInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : integer(value);
}

function safeDeliveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Telegram delivery failed.";
  return message.slice(0, 500);
}

export class SupabaseSideEffectQueue implements SideEffectQueue {
  constructor(
    private readonly client: SupabaseClient,
    private readonly telegram: TelegramGateway | null,
    private readonly googleSheets: GoogleSheetsGateway | null = null,
  ) {}

  async queueSheetSync(transactionId: string, kind: TransactionKind): Promise<void> {
    const { error } = await this.client.from("google_sheet_sync_jobs").upsert(
      {
        transaction_id: transactionId,
        sheet_tab: kind === "sale" ? "Sales" : "Expenses",
        state: "PENDING",
        last_error: this.googleSheets ? null : "Google Sheets synchronization is not configured.",
        synced_at: null,
        next_retry_at: null,
      },
      { onConflict: "transaction_id" },
    );
    if (error) {
      throw new DomainError(
        "PERSISTENCE_FAILED",
        "The transaction was saved, but its future synchronization state could not be recorded.",
        error,
      );
    }
    if (this.googleSheets) await this.deliverSheetSync(transactionId);
  }

  async retrySheetSync(
    manager: Actor,
    transactionId: string,
  ): Promise<"SYNCED" | "FAILED"> {
    assertCanPerform(manager.role, "retry_sheet_sync");
    if (!this.googleSheets) {
      throw new DomainError("INTEGRATION_NOT_CONFIGURED", "Google Sheets is not configured.");
    }
    return this.deliverSheetSync(transactionId);
  }

  async queueNotification(input: {
    transactionId: string;
    kind: NotificationKind;
    fixedDestinationChatId: string | null;
    fallbackEmployeeId: string | null;
  }): Promise<void> {
    const transaction = await this.loadTransaction(input.transactionId);
    const currentLinkedChatId = input.fallbackEmployeeId
      ? await this.findEmployeeChat(input.fallbackEmployeeId)
      : null;
    const destinationChatId = selectNotificationDestination({
      origin: transaction.origin as "website" | "telegram",
      originalTelegramChatId: input.fixedDestinationChatId,
      currentEmployeeLinkedChatId: currentLinkedChatId,
    });
    const kind = notificationKinds[input.kind];
    const text = await this.buildMessage(transaction, kind);
    const noRecipient = !destinationChatId;
    const { error } = await this.client.from("notification_jobs").upsert(
      {
        transaction_id: input.transactionId,
        kind,
        destination_chat_id: destinationChatId,
        state: noRecipient ? "NOT_REQUIRED" : "PENDING",
        payload: { text },
        last_error: noRecipient
          ? null
          : this.telegram
            ? null
            : "Telegram delivery is not configured.",
        not_required_reason: noRecipient ? "No Telegram recipient linked" : null,
        sent_at: null,
        next_retry_at: null,
      },
      { onConflict: "transaction_id,kind" },
    );
    if (error) {
      throw new DomainError(
        "PERSISTENCE_FAILED",
        "The transaction was saved, but its notification state could not be recorded.",
        error,
      );
    }
    if (destinationChatId && this.telegram) {
      await this.deliver(input.transactionId, kind);
    }
  }

  async retryNotification(
    manager: Actor,
    transactionId: string,
    kind: DatabaseNotificationKind,
  ): Promise<"SENT" | "FAILED" | "NOT_REQUIRED"> {
    assertCanPerform(manager.role, "retry_notification");
    if (!this.telegram) {
      throw new DomainError("INTEGRATION_NOT_CONFIGURED", "Telegram is not configured.");
    }
    return this.deliver(transactionId, kind);
  }

  private async deliver(
    transactionId: string,
    kind: DatabaseNotificationKind,
  ): Promise<"SENT" | "FAILED" | "NOT_REQUIRED"> {
    const { data, error } = await this.client
      .from("notification_jobs")
      .select("destination_chat_id,state,payload,attempt_count")
      .eq("transaction_id", transactionId)
      .eq("kind", kind)
      .maybeSingle();
    if (error) throw new DomainError("PERSISTENCE_FAILED", "The notification could not be loaded.", error);
    if (!data) throw new DomainError("TRANSACTION_NOT_FOUND", "The notification no longer exists.");
    if (data.state === "SENT") return "SENT";
    if (!data.destination_chat_id) return "NOT_REQUIRED";

    const payload = data.payload as { text?: unknown } | null;
    const text = typeof payload?.text === "string" ? payload.text : "";
    if (!text) throw new DomainError("PERSISTENCE_FAILED", "The notification has no message to send.");
    const attemptCount = integer(data.attempt_count) + 1;
    try {
      await this.telegram!.sendMessage(String(data.destination_chat_id), text);
      const { error: updateError } = await this.client
        .from("notification_jobs")
        .update({
          state: "SENT",
          attempt_count: attemptCount,
          last_attempt_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          next_retry_at: null,
          last_error: null,
        })
        .eq("transaction_id", transactionId)
        .eq("kind", kind);
      if (updateError) throw updateError;
      return "SENT";
    } catch (deliveryError) {
      const nextRetry = new Date(Date.now() + 5 * 60_000).toISOString();
      const { error: updateError } = await this.client
        .from("notification_jobs")
        .update({
          state: "FAILED",
          attempt_count: attemptCount,
          last_attempt_at: new Date().toISOString(),
          sent_at: null,
          next_retry_at: nextRetry,
          last_error: safeDeliveryError(deliveryError),
        })
        .eq("transaction_id", transactionId)
        .eq("kind", kind);
      if (updateError) {
        throw new DomainError(
          "PERSISTENCE_FAILED",
          "Telegram delivery failed and its retry state could not be saved.",
          updateError,
        );
      }
      return "FAILED";
    }
  }

  private async deliverSheetSync(transactionId: string): Promise<"SYNCED" | "FAILED"> {
    if (!this.googleSheets) {
      throw new DomainError("INTEGRATION_NOT_CONFIGURED", "Google Sheets is not configured.");
    }
    const { data, error } = await this.client
      .from("google_sheet_sync_jobs")
      .select("sheet_tab,attempt_count")
      .eq("transaction_id", transactionId)
      .maybeSingle();
    if (error) throw new DomainError("PERSISTENCE_FAILED", "The synchronization job could not be loaded.", error);
    if (!data) throw new DomainError("TRANSACTION_NOT_FOUND", "The synchronization job no longer exists.");
    const tab = data.sheet_tab as SheetTab;
    const attemptCount = integer(data.attempt_count) + 1;
    try {
      const row = await this.buildSheetRow(transactionId, tab);
      const result = await this.googleSheets.upsertByReference(tab, row);
      const { error: updateError } = await this.client
        .from("google_sheet_sync_jobs")
        .update({
          state: "SYNCED",
          row_number: result.rowNumber,
          attempt_count: attemptCount,
          last_attempt_at: new Date().toISOString(),
          synced_at: new Date().toISOString(),
          next_retry_at: null,
          last_error: null,
        })
        .eq("transaction_id", transactionId);
      if (updateError) throw updateError;
      return "SYNCED";
    } catch (syncError) {
      const { error: updateError } = await this.client
        .from("google_sheet_sync_jobs")
        .update({
          state: "FAILED",
          attempt_count: attemptCount,
          last_attempt_at: new Date().toISOString(),
          synced_at: null,
          next_retry_at: new Date(Date.now() + 5 * 60_000).toISOString(),
          last_error: safeGoogleSheetsError(syncError),
        })
        .eq("transaction_id", transactionId);
      if (updateError) {
        throw new DomainError(
          "PERSISTENCE_FAILED",
          "Google Sheets synchronization failed and its retry state could not be saved.",
          updateError,
        );
      }
      return "FAILED";
    }
  }

  private async buildSheetRow(transactionId: string, tab: SheetTab): Promise<SheetRow> {
    const { data: transaction, error: transactionError } = await this.client
      .from("transactions")
      .select("reference,submitted_at,submitted_by_employee_id")
      .eq("id", transactionId)
      .maybeSingle();
    if (transactionError || !transaction) {
      throw new DomainError("PERSISTENCE_FAILED", "The transaction could not be prepared for synchronization.", transactionError);
    }
    const [employeeResult, detailResult] = await Promise.all([
      this.client
        .from("employees")
        .select("display_name")
        .eq("id", transaction.submitted_by_employee_id)
        .maybeSingle(),
      this.client
        .from(tab === "Sales" ? "sales" : "expenses")
        .select("*")
        .eq("transaction_id", transactionId)
        .maybeSingle(),
    ]);
    if (employeeResult.error || detailResult.error || !employeeResult.data || !detailResult.data) {
      throw new DomainError(
        "PERSISTENCE_FAILED",
        "The transaction details could not be prepared for synchronization.",
        employeeResult.error ?? detailResult.error,
      );
    }
    const detail = detailResult.data as DbRow;
    const reference = String(transaction.reference);
    const submittedAt = String(transaction.submitted_at);
    const submitter = String(employeeResult.data.display_name);
    if (tab === "Sales") {
      const status = detail.status as "PENDING_APPROVAL" | "APPROVED";
      const finalRichard = nullableInteger(detail.final_richard_percent);
      const finalAnastasia = nullableInteger(detail.final_anastasia_percent);
      const finalJeanClaude = nullableInteger(detail.final_jean_claude_percent);
      return serializeSaleRow({
        reference,
        submittedAt,
        salesperson: submitter,
        customer: String(detail.customer),
        project: detail.project as "A" | "B",
        description: String(detail.description),
        amountCents: integer(detail.amount_cents),
        proposedSplit: {
          richard: integer(detail.proposed_richard_percent),
          anastasia: integer(detail.proposed_anastasia_percent),
          jeanClaude: integer(detail.proposed_jean_claude_percent),
        },
        finalSplit: finalRichard === null || finalAnastasia === null || finalJeanClaude === null
          ? null
          : { richard: finalRichard, anastasia: finalAnastasia, jeanClaude: finalJeanClaude },
        commission: status === "APPROVED"
          ? {
              poolCents: integer(detail.commission_pool_cents),
              richardCents: integer(detail.richard_commission_cents),
              anastasiaCents: integer(detail.anastasia_commission_cents),
              jeanClaudeCents: integer(detail.jean_claude_commission_cents),
            }
          : null,
        status,
      });
    }
    return serializeExpenseRow({
      reference,
      submittedAt,
      reporter: submitter,
      description: String(detail.description),
      category: detail.category as "Materials" | "Travel" | "Other",
      amountCents: integer(detail.amount_cents),
      proposedAllocation: detail.proposed_allocation as AllocationTarget,
      finalAllocation: (detail.final_allocation as AllocationTarget | null) ?? null,
      status: detail.status as "AWAITING_ALLOCATION" | "ALLOCATED",
    });
  }

  private async findEmployeeChat(employeeId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("telegram_employee_links")
      .select("latest_private_chat_id")
      .eq("employee_id", employeeId)
      .not("latest_private_chat_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new DomainError("PERSISTENCE_FAILED", "The Telegram recipient link could not be checked.", error);
    }
    return data?.latest_private_chat_id ? String(data.latest_private_chat_id) : null;
  }

  private async loadTransaction(transactionId: string): Promise<DbRow> {
    const { data, error } = await this.client
      .from("transactions")
      .select("*")
      .eq("id", transactionId)
      .maybeSingle();
    if (error) throw new DomainError("PERSISTENCE_FAILED", "The transaction could not be loaded.", error);
    if (!data) throw new DomainError("TRANSACTION_NOT_FOUND", "The transaction no longer exists.");
    return data as DbRow;
  }

  private async buildMessage(
    transaction: DbRow,
    kind: DatabaseNotificationKind,
  ): Promise<string> {
    const transactionId = String(transaction.id);
    const reference = String(transaction.reference);
    if (kind === "SALE_SUBMISSION_CONFIRMATION" || kind === "SALE_APPROVAL_DECISION") {
      const { data, error } = await this.client
        .from("sales")
        .select("*")
        .eq("transaction_id", transactionId)
        .single();
      if (error || !data) {
        throw new DomainError("PERSISTENCE_FAILED", "The sale notification could not be prepared.", error);
      }
      if (kind === "SALE_SUBMISSION_CONFIRMATION") {
        return formatSaleSubmissionMessage({
          reference,
          amountCents: integer(data.amount_cents),
          project: data.project as "A" | "B",
        });
      }
      const proposedSplit: CommissionSplit = {
        richard: integer(data.proposed_richard_percent),
        anastasia: integer(data.proposed_anastasia_percent),
        jeanClaude: integer(data.proposed_jean_claude_percent),
      };
      const finalSplit: CommissionSplit = {
        richard: integer(data.final_richard_percent),
        anastasia: integer(data.final_anastasia_percent),
        jeanClaude: integer(data.final_jean_claude_percent),
      };
      return formatSaleDecisionMessage({
        reference,
        amountCents: integer(data.amount_cents),
        proposedSplit,
        finalSplit,
        commission: {
          poolCents: integer(data.commission_pool_cents),
          richardCents: integer(data.richard_commission_cents),
          anastasiaCents: integer(data.anastasia_commission_cents),
          jeanClaudeCents: integer(data.jean_claude_commission_cents),
        },
        managerChangedSplit: Boolean(data.manager_changed_split),
      });
    }

    const { data, error } = await this.client
      .from("expenses")
      .select("*")
      .eq("transaction_id", transactionId)
      .single();
    if (error || !data) {
      throw new DomainError("PERSISTENCE_FAILED", "The expense notification could not be prepared.", error);
    }
    if (kind === "EXPENSE_SUBMISSION_CONFIRMATION") {
      return formatExpenseSubmissionMessage({
        reference,
        amountCents: integer(data.amount_cents),
        proposedAllocation: data.proposed_allocation as AllocationTarget,
        finalAllocation: (data.final_allocation as AllocationTarget | null) ?? null,
        status: data.status as "AWAITING_ALLOCATION" | "ALLOCATED",
      });
    }
    return formatExpenseDecisionMessage({
      reference,
      amountCents: integer(data.amount_cents),
      description: String(data.description),
      proposedAllocation: data.proposed_allocation as AllocationTarget,
      finalAllocation: data.final_allocation as AllocationTarget,
      managerChangedAllocation: Boolean(data.manager_changed_allocation),
    });
  }
}
