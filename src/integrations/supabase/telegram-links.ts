import type { SupabaseClient } from "@supabase/supabase-js";
import type { TelegramLinkView } from "@/src/application/read-models";
import { EMPLOYEE_CODES, type EmployeeCode, type EmployeeRole } from "@/src/domain/employees";
import { DomainError } from "@/src/domain/errors";
import { assertCanPerform } from "@/src/domain/permissions";
import type { Actor } from "@/src/domain/types";

type DbRow = Record<string, unknown>;

function persistenceError(message: string, details?: unknown): DomainError {
  return new DomainError("PERSISTENCE_FAILED", message, details);
}

export function normalizeTelegramId(value: string): string {
  const normalized = value.trim();
  if (!/^\d{1,19}$/.test(normalized)) {
    throw new DomainError("VALIDATION_FAILED", "Enter a valid numeric Telegram user ID.");
  }
  const numeric = BigInt(normalized);
  if (numeric <= BigInt(0) || numeric > BigInt("9223372036854775807")) {
    throw new DomainError("VALIDATION_FAILED", "Enter a valid numeric Telegram user ID.");
  }
  return normalized;
}

export class SupabaseTelegramLinkRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listLinks(): Promise<TelegramLinkView[]> {
    const [linksResult, employeesResult] = await Promise.all([
      this.client
        .from("telegram_employee_links")
        .select("telegram_user_id,employee_id,latest_private_chat_id,updated_at")
        .order("updated_at", { ascending: false }),
      this.client.from("employees").select("id,code,display_name"),
    ]);
    if (linksResult.error || employeesResult.error) {
      throw persistenceError(
        "Telegram account links could not be loaded.",
        linksResult.error ?? employeesResult.error,
      );
    }
    const employees = new Map(
      ((employeesResult.data ?? []) as DbRow[]).map((row) => [String(row.id), row]),
    );
    return ((linksResult.data ?? []) as DbRow[]).map((row) => {
      const employee = employees.get(String(row.employee_id));
      if (!employee) throw persistenceError("A Telegram link refers to a missing employee.");
      return {
        telegramUserId: String(row.telegram_user_id),
        employeeCode: employee.code as EmployeeCode,
        employeeName: String(employee.display_name),
        hasPrivateChat: row.latest_private_chat_id !== null,
        updatedAt: String(row.updated_at),
      };
    });
  }

  async linkUser(
    manager: Actor,
    telegramUserIdInput: string,
    employeeCode: EmployeeCode,
  ): Promise<void> {
    assertCanPerform(manager.role, "manage_telegram_links");
    if (!EMPLOYEE_CODES.includes(employeeCode)) {
      throw new DomainError("VALIDATION_FAILED", "Choose a valid fictional employee.");
    }
    const telegramUserId = normalizeTelegramId(telegramUserIdInput);
    const { data: employee, error: employeeError } = await this.client
      .from("employees")
      .select("id")
      .eq("code", employeeCode)
      .eq("active", true)
      .single();
    if (employeeError || !employee) {
      throw persistenceError("The selected employee could not be found.", employeeError);
    }

    const { data: existing, error: existingError } = await this.client
      .from("telegram_employee_links")
      .select("latest_private_chat_id")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    if (existingError) throw persistenceError("The existing Telegram link could not be checked.", existingError);

    const { error } = await this.client.from("telegram_employee_links").upsert(
      {
        telegram_user_id: telegramUserId,
        employee_id: employee.id,
        latest_private_chat_id: existing?.latest_private_chat_id ?? null,
        linked_by_employee_id: manager.employeeId,
        linked_at: new Date().toISOString(),
      },
      { onConflict: "telegram_user_id" },
    );
    if (error) throw persistenceError("The Telegram account link could not be saved.", error);
  }

  async resolveActorByTelegramUser(
    telegramUserIdInput: string,
    privateChatId: string,
  ): Promise<Actor | null> {
    const telegramUserId = normalizeTelegramId(telegramUserIdInput);
    const { data: link, error: linkError } = await this.client
      .from("telegram_employee_links")
      .select("employee_id")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    if (linkError) throw persistenceError("The Telegram account link could not be checked.", linkError);
    if (!link) return null;

    const { data: employee, error: employeeError } = await this.client
      .from("employees")
      .select("id,code,role,active")
      .eq("id", link.employee_id)
      .eq("active", true)
      .maybeSingle();
    if (employeeError) throw persistenceError("The linked employee could not be loaded.", employeeError);
    if (!employee) return null;

    const { error: updateError } = await this.client
      .from("telegram_employee_links")
      .update({ latest_private_chat_id: privateChatId })
      .eq("telegram_user_id", telegramUserId);
    if (updateError) throw persistenceError("The Telegram private chat could not be recorded.", updateError);

    return {
      employeeId: String(employee.id),
      employeeCode: employee.code as EmployeeCode,
      role: employee.role as EmployeeRole,
    };
  }
}
