"use server";

import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import type { ActionState } from "@/src/application/action-state";
import { createServerServices } from "@/src/application/server-services";
import { EMPLOYEE_CODES, type EmployeeCode } from "@/src/domain/employees";
import { DomainError } from "@/src/domain/errors";
import { parseEuroAmountToCents } from "@/src/domain/money";
import type { DatabaseNotificationKind } from "@/src/integrations/supabase/side-effect-queue";

const actorCodeSchema = z.enum(EMPLOYEE_CODES);
const notificationKindSchema = z.enum([
  "SALE_SUBMISSION_CONFIRMATION",
  "EXPENSE_SUBMISSION_CONFIRMATION",
  "SALE_APPROVAL_DECISION",
  "EXPENSE_ALLOCATION_DECISION",
]);

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function formInteger(formData: FormData, name: string): number {
  const value = formText(formData, name).trim();
  if (!/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}

function actionError(error: unknown): ActionState {
  if (error instanceof ZodError) {
    return { status: "error", message: error.issues[0]?.message ?? "Check the form values." };
  }
  if (error instanceof DomainError || error instanceof Error) {
    return { status: "error", message: error.message };
  }
  return { status: "error", message: "The request could not be completed." };
}

async function actorFrom(formData: FormData) {
  const code = actorCodeSchema.parse(formText(formData, "actorCode")) as EmployeeCode;
  const services = createServerServices();
  const actor = await services.repository.resolveActor(code);
  return { ...services, actor };
}

export async function submitSaleAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { processor, actor } = await actorFrom(formData);
    const sale = await processor.submitSale(actor, { origin: "website" }, {
      reference: formText(formData, "reference"),
      customer: formText(formData, "customer"),
      project: formText(formData, "project") as "A" | "B",
      description: formText(formData, "description"),
      amountCents: parseEuroAmountToCents(formText(formData, "amount")),
      proposedSplit: {
        richard: formInteger(formData, "richardPercent"),
        anastasia: formInteger(formData, "anastasiaPercent"),
        jeanClaude: formInteger(formData, "jeanClaudePercent"),
      },
    });
    revalidatePath("/");
    return { status: "success", message: `Sale ${sale.reference} was saved for approval.` };
  } catch (error) {
    return actionError(error);
  }
}

export async function submitExpenseAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { processor, actor } = await actorFrom(formData);
    const expense = await processor.submitExpense(actor, { origin: "website" }, {
      reference: formText(formData, "reference"),
      description: formText(formData, "description"),
      category: formText(formData, "category") as "Materials" | "Travel" | "Other",
      amountCents: parseEuroAmountToCents(formText(formData, "amount")),
      proposedAllocation: formText(formData, "proposedAllocation") as
        | "A"
        | "B"
        | "COMPANY_OVERHEAD",
    });
    revalidatePath("/");
    const message = expense.status === "ALLOCATED"
      ? `Expense ${expense.reference} was saved as company overhead.`
      : `Expense ${expense.reference} was saved and awaits allocation.`;
    return { status: "success", message };
  } catch (error) {
    return actionError(error);
  }
}

export async function approveSaleAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { processor, actor } = await actorFrom(formData);
    const result = await processor.approveSale(actor, {
      transactionId: formText(formData, "transactionId"),
      finalSplit: {
        richard: formInteger(formData, "richardPercent"),
        anastasia: formInteger(formData, "anastasiaPercent"),
        jeanClaude: formInteger(formData, "jeanClaudePercent"),
      },
    });
    revalidatePath("/");
    return {
      status: "success",
      message: result.transitioned
        ? `Sale ${result.record.reference} was approved.`
        : `Sale ${result.record.reference} was already approved; no totals were duplicated.`,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function allocateExpenseAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { processor, actor } = await actorFrom(formData);
    const result = await processor.allocateExpense(actor, {
      transactionId: formText(formData, "transactionId"),
      finalAllocation: formText(formData, "finalAllocation") as
        | "A"
        | "B"
        | "COMPANY_OVERHEAD",
    });
    revalidatePath("/");
    return {
      status: "success",
      message: result.transitioned
        ? `Expense ${result.record.reference} was allocated.`
        : `Expense ${result.record.reference} was already allocated; no totals were duplicated.`,
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function linkTelegramUserAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { actor, telegramLinks } = await actorFrom(formData);
    const employeeCode = actorCodeSchema.parse(formText(formData, "employeeCode"));
    await telegramLinks.linkUser(actor, formText(formData, "telegramUserId"), employeeCode);
    revalidatePath("/");
    return {
      status: "success",
      message: "Telegram account link saved. Ask the user to send /start to the bot again.",
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function retryTelegramNotificationAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { actor, sideEffects } = await actorFrom(formData);
    const kind = notificationKindSchema.parse(
      formText(formData, "notificationKind"),
    ) as DatabaseNotificationKind;
    const result = await sideEffects.retryNotification(
      actor,
      formText(formData, "transactionId"),
      kind,
    );
    revalidatePath("/");
    return {
      status: result === "SENT" ? "success" : "error",
      message:
        result === "SENT"
          ? "Telegram notification sent."
          : result === "NOT_REQUIRED"
            ? "No Telegram recipient is linked."
            : "Telegram delivery failed again and remains available for retry.",
    };
  } catch (error) {
    return actionError(error);
  }
}
