import { ZodError } from "zod";
import type { TransactionProcessor } from "@/src/application/transaction-processor";
import type { EmployeeRole } from "@/src/domain/employees";
import { DomainError } from "@/src/domain/errors";
import { parseEuroAmountToCents } from "@/src/domain/money";
import type { Actor, AllocationTarget, ExpenseCategory } from "@/src/domain/types";
import type { SupabaseTelegramLinkRepository } from "@/src/integrations/supabase/telegram-links";
import type { TelegramGateway } from "@/src/integrations/telegram/client";

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number; type?: string };
    from?: { id?: number; is_bot?: boolean };
  };
}

export interface TelegramIdentityDirectory {
  resolveActorByTelegramUser(userId: string, chatId: string): Promise<Actor | null>;
}

type TelegramProcessor = Pick<TransactionProcessor, "submitSale" | "submitExpense">;

function commandAndBody(text: string): { command: string; body: string } {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  if (!match) return { command: "", body: trimmed };
  return { command: match[1].toLowerCase(), body: match[2]?.trim() ?? "" };
}

function integer(value: string, label: string): number {
  if (!/^\d+$/.test(value.trim())) throw new Error(`${label} must be a whole percentage.`);
  return Number(value.trim());
}

function category(value: string): ExpenseCategory {
  const normalized = value.trim().toLowerCase();
  if (normalized === "materials") return "Materials";
  if (normalized === "travel") return "Travel";
  if (normalized === "other") return "Other";
  throw new Error("Category must be Materials, Travel, or Other.");
}

function allocation(value: string): AllocationTarget {
  const normalized = value.trim().toLowerCase().replaceAll("_", " ");
  if (normalized === "a" || normalized === "project a") return "A";
  if (normalized === "b" || normalized === "project b") return "B";
  if (normalized === "company overhead" || normalized === "overhead") return "COMPANY_OVERHEAD";
  throw new Error("Allocation must be A, B, or Company overhead.");
}

function userError(error: unknown): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Check the transaction details.";
  if (error instanceof DomainError || error instanceof Error) return error.message;
  return "The transaction could not be processed. Please check the details and try again.";
}

function helpFor(role: EmployeeRole | null): string {
  const common = [
    "Friends Included finance bot",
    "Use a vertical bar | between each item.",
  ];
  if (role === "salesperson") {
    return [
      ...common,
      "Submit a sale:",
      "/sale REFERENCE | Customer | A or B | Description | Amount | Richard % | Anastasia % | Jean-Claude %",
      "Example: /sale DEMO-SALE | Customer Name | A | Guest service | 125.50 | 40 | 30 | 30",
    ].join("\n");
  }
  if (role === "expense_reporter") {
    return [
      ...common,
      "Submit an expense:",
      "/expense REFERENCE | Description | Amount | Materials, Travel, or Other | A, B, or Company overhead",
      "Example: /expense DEMO-EXPENSE | Costume supplies | 45.75 | Materials | A",
    ].join("\n");
  }
  if (role === "manager") {
    return [...common, "Svetlana uses the website manager area for links and decisions."].join("\n");
  }
  return [
    ...common,
    "This Telegram account is not linked.",
    "Ask Svetlana to link the numeric Telegram user ID shown by /start.",
  ].join("\n");
}

export class TelegramUpdateHandler {
  constructor(
    private readonly processor: TelegramProcessor,
    private readonly identities: TelegramIdentityDirectory | SupabaseTelegramLinkRepository,
    private readonly telegram: TelegramGateway,
  ) {}

  async handle(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message?.text || message.chat?.type !== "private" || message.from?.is_bot) return;
    if (message.chat.id === undefined || message.from?.id === undefined) return;

    const chatId = String(message.chat.id);
    const userId = String(message.from.id);
    const actor = await this.identities.resolveActorByTelegramUser(userId, chatId);
    const { command, body } = commandAndBody(message.text);

    if (command === "start") {
      const status = actor
        ? `Linked as ${actor.employeeCode}.`
        : `Not linked. Your Telegram user ID is ${userId}. Ask Svetlana to link it in the website manager area.`;
      await this.telegram.sendMessage(chatId, `Friends Included finance bot\n${status}\n\n${helpFor(actor?.role ?? null)}`);
      return;
    }
    if (command === "help") {
      await this.telegram.sendMessage(chatId, helpFor(actor?.role ?? null));
      return;
    }
    if (!actor) {
      await this.telegram.sendMessage(
        chatId,
        `Transaction refused: this Telegram account is not linked. Your Telegram user ID is ${userId}. Ask Svetlana to link it through the website.`,
      );
      return;
    }

    if (command === "sale") {
      await this.handleSale(actor, userId, chatId, body);
      return;
    }
    if (command === "expense") {
      await this.handleExpense(actor, userId, chatId, body);
      return;
    }
    await this.telegram.sendMessage(chatId, `Unknown command.\n\n${helpFor(actor.role)}`);
  }

  private async handleSale(actor: Actor, userId: string, chatId: string, body: string) {
    try {
      const fields = body.split("|").map((value) => value.trim());
      if (fields.length !== 8) {
        throw new Error("Use: /sale REFERENCE | Customer | A or B | Description | Amount | Richard % | Anastasia % | Jean-Claude %");
      }
      await this.processor.submitSale(actor, {
        origin: "telegram",
        telegramUserId: userId,
        telegramChatId: chatId,
      }, {
        reference: fields[0],
        customer: fields[1],
        project: fields[2].toUpperCase() as "A" | "B",
        description: fields[3],
        amountCents: parseEuroAmountToCents(fields[4]),
        proposedSplit: {
          richard: integer(fields[5], "Richard's share"),
          anastasia: integer(fields[6], "Anastasia's share"),
          jeanClaude: integer(fields[7], "Jean-Claude's share"),
        },
      });
    } catch (error) {
      await this.telegram.sendMessage(chatId, `Sale not recorded: ${userError(error)}`);
    }
  }

  private async handleExpense(actor: Actor, userId: string, chatId: string, body: string) {
    try {
      const fields = body.split("|").map((value) => value.trim());
      if (fields.length !== 5) {
        throw new Error("Use: /expense REFERENCE | Description | Amount | Materials, Travel, or Other | A, B, or Company overhead");
      }
      await this.processor.submitExpense(actor, {
        origin: "telegram",
        telegramUserId: userId,
        telegramChatId: chatId,
      }, {
        reference: fields[0],
        description: fields[1],
        amountCents: parseEuroAmountToCents(fields[2]),
        category: category(fields[3]),
        proposedAllocation: allocation(fields[4]),
      });
    } catch (error) {
      await this.telegram.sendMessage(chatId, `Expense not recorded: ${userError(error)}`);
    }
  }
}
