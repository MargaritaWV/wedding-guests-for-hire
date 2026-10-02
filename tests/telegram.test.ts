import { afterEach, describe, expect, it } from "vitest";
import { getIntegrationReadiness } from "../src/integrations/config";
import { TelegramUpdateHandler, type TelegramIdentityDirectory } from "../src/integrations/telegram/handler";
import type { TelegramGateway } from "../src/integrations/telegram/client";
import {
  formatExpenseDecisionMessage,
  formatSaleDecisionMessage,
  selectNotificationDestination,
} from "../src/integrations/telegram/messages";
import { verifyTelegramWebhookSecret } from "../src/integrations/telegram/webhook-security";
import { assertCanPerform } from "../src/domain/permissions";
import { expenseSubmissionSchema, saleSubmissionSchema } from "../src/domain/validation";
import { DomainError } from "../src/domain/errors";
import type {
  Actor,
  ExpenseSubmissionInput,
  PersistedExpense,
  PersistedSale,
  SaleSubmissionInput,
  SubmissionContext,
} from "../src/domain/types";

const salesperson: Actor = {
  employeeId: "00000000-0000-4000-8000-000000000001",
  employeeCode: "richard",
  role: "salesperson",
};
const kevin: Actor = {
  employeeId: "00000000-0000-4000-8000-000000000002",
  employeeCode: "kevin",
  role: "expense_reporter",
};

class FakeGateway implements TelegramGateway {
  messages: Array<{ chatId: string; text: string }> = [];
  async sendMessage(chatId: string, text: string) {
    this.messages.push({ chatId, text });
  }
  async getMe() {
    return { id: 1, username: "FriendsIncludedHomeworkBot", first_name: "Friends Included" };
  }
  async getWebhookInfo() {
    return { url: "", pending_update_count: 0 };
  }
  async setWebhook() {}
}

class FakeIdentityDirectory implements TelegramIdentityDirectory {
  actor: Actor | null = null;
  resolved: Array<{ userId: string; chatId: string }> = [];
  async resolveActorByTelegramUser(userId: string, chatId: string) {
    this.resolved.push({ userId, chatId });
    return this.actor;
  }
}

class FakeProcessor {
  sales: PersistedSale[] = [];
  expenses: PersistedExpense[] = [];
  references = new Set<string>();

  async submitSale(actor: Actor, context: SubmissionContext, raw: SaleSubmissionInput) {
    assertCanPerform(actor.role, "submit_sale");
    const input = saleSubmissionSchema.parse(raw);
    const reference = input.reference.toUpperCase();
    if (this.references.has(reference)) {
      throw new DomainError("DUPLICATE_REFERENCE", "That transaction reference already exists.");
    }
    this.references.add(reference);
    const sale: PersistedSale = {
      transactionId: "00000000-0000-4000-8000-000000000010",
      reference,
      submittedByEmployeeId: actor.employeeId,
      origin: context.origin,
      originTelegramChatId: context.telegramChatId ?? null,
      customer: input.customer,
      project: input.project,
      description: input.description,
      amountCents: input.amountCents,
      proposedSplit: input.proposedSplit,
      finalSplit: null,
      status: "PENDING_APPROVAL",
      commission: null,
    };
    this.sales.push(sale);
    return sale;
  }

  async submitExpense(actor: Actor, context: SubmissionContext, raw: ExpenseSubmissionInput) {
    assertCanPerform(actor.role, "submit_expense");
    const input = expenseSubmissionSchema.parse(raw);
    const reference = input.reference.toUpperCase();
    if (this.references.has(reference)) {
      throw new DomainError("DUPLICATE_REFERENCE", "That transaction reference already exists.");
    }
    this.references.add(reference);
    const overhead = input.proposedAllocation === "COMPANY_OVERHEAD";
    const expense: PersistedExpense = {
      transactionId: "00000000-0000-4000-8000-000000000011",
      reference,
      submittedByEmployeeId: actor.employeeId,
      origin: context.origin,
      originTelegramChatId: context.telegramChatId ?? null,
      description: input.description,
      category: input.category,
      amountCents: input.amountCents,
      proposedAllocation: input.proposedAllocation,
      finalAllocation: overhead ? "COMPANY_OVERHEAD" : null,
      status: overhead ? "ALLOCATED" : "AWAITING_ALLOCATION",
    };
    this.expenses.push(expense);
    return expense;
  }
}

function telegramUpdate(text: string) {
  return {
    update_id: 123,
    message: {
      text,
      chat: { id: 456, type: "private" },
      from: { id: 789, is_bot: false },
    },
  };
}

function setup(actor: Actor | null) {
  const processor = new FakeProcessor();
  const identities = new FakeIdentityDirectory();
  identities.actor = actor;
  const telegram = new FakeGateway();
  const handler = new TelegramUpdateHandler(processor, identities, telegram);
  return { processor, identities, telegram, handler };
}

describe("Telegram command handling", () => {
  it("denies an unlinked Telegram user's transaction", async () => {
    const { processor, telegram, handler } = setup(null);
    await handler.handle(telegramUpdate("/sale X | Customer | A | Work | 10 | 40 | 30 | 30"));
    expect(processor.sales).toHaveLength(0);
    expect(telegram.messages[0].text).toContain("not linked");
  });

  it("does not let a Telegram user assign their own fictional role", async () => {
    const { identities, telegram, handler } = setup(null);
    await handler.handle(telegramUpdate("/link richard"));
    expect(identities.actor).toBeNull();
    expect(telegram.messages[0].text).toContain("not linked");
  });

  it("submits a salesperson sale through the shared input contract with original chat", async () => {
    const { processor, handler } = setup(salesperson);
    await handler.handle(telegramUpdate("/sale TG-SALE | Customer | A | Guest service | 125.50 | 40 | 30 | 30"));
    expect(processor.sales).toHaveLength(1);
    expect(processor.sales[0]).toMatchObject({
      reference: "TG-SALE",
      submittedByEmployeeId: salesperson.employeeId,
      origin: "telegram",
      originTelegramChatId: "456",
      status: "PENDING_APPROVAL",
    });
  });

  it("submits a Kevin expense and rejects Kevin's sale", async () => {
    const { processor, telegram, handler } = setup(kevin);
    await handler.handle(telegramUpdate("/expense TG-EXP | Costume supplies | 45.75 | Materials | A"));
    await handler.handle(telegramUpdate("/sale BAD | Customer | A | Work | 10 | 40 | 30 | 30"));
    expect(processor.expenses).toHaveLength(1);
    expect(processor.expenses[0]).toMatchObject({
      submittedByEmployeeId: kevin.employeeId,
      originTelegramChatId: "456",
      status: "AWAITING_ALLOCATION",
    });
    expect(telegram.messages.at(-1)?.text).toContain("not allowed to perform submit sale");
  });

  it("clearly rejects an invalid commission split", async () => {
    const { processor, telegram, handler } = setup(salesperson);
    await handler.handle(telegramUpdate("/sale BAD-SPLIT | Customer | A | Work | 10 | 60 | 30 | 20"));
    expect(processor.sales).toHaveLength(0);
    expect(telegram.messages[0].text).toContain("total exactly 100%");
  });

  it("does not duplicate a transaction when the same update is delivered twice", async () => {
    const { processor, handler } = setup(salesperson);
    const update = telegramUpdate("/sale TG-ONCE | Customer | B | Work | 50 | 50 | 25 | 25");
    await handler.handle(update);
    await handler.handle(update);
    expect(processor.sales).toHaveLength(1);
  });
});

describe("Telegram notification rules", () => {
  it("always uses the original chat for Telegram submissions after relinking", () => {
    expect(selectNotificationDestination({
      origin: "telegram",
      originalTelegramChatId: "original-chat",
      currentEmployeeLinkedChatId: "new-chat",
    })).toBe("original-chat");
  });

  it("uses the current employee link for website submissions", () => {
    expect(selectNotificationDestination({
      origin: "website",
      originalTelegramChatId: null,
      currentEmployeeLinkedChatId: "linked-chat",
    })).toBe("linked-chat");
    expect(selectNotificationDestination({
      origin: "website",
      originalTelegramChatId: null,
      currentEmployeeLinkedChatId: null,
    })).toBeNull();
  });

  it("formats changed commission and allocation decisions dynamically", () => {
    const sale = formatSaleDecisionMessage({
      reference: "TEMP",
      amountCents: 20_000,
      proposedSplit: { richard: 0, anastasia: 50, jeanClaude: 50 },
      finalSplit: { richard: 20, anastasia: 40, jeanClaude: 40 },
      commission: { poolCents: 2_000, richardCents: 400, anastasiaCents: 800, jeanClaudeCents: 800 },
      managerChangedSplit: true,
    });
    expect(sale).toContain("0% → 20% (€4.00)");
    expect(sale).toContain("Total commission: €20.00");

    const expense = formatExpenseDecisionMessage({
      reference: "TEMP-E",
      amountCents: 9_000,
      description: "Temporary taxi",
      proposedAllocation: "A",
      finalAllocation: "B",
      managerChangedAllocation: true,
    });
    expect(expense).toContain("Proposed: Project A");
    expect(expense).toContain("Approved: Project B");
  });
});

describe("Telegram security and honest readiness", () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const originalEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const originalKey = process.env.GOOGLE_PRIVATE_KEY;
  const originalSheet = process.env.GOOGLE_SPREADSHEET_ID;

  afterEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = originalToken;
    process.env.TELEGRAM_WEBHOOK_SECRET = originalSecret;
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = originalEmail;
    process.env.GOOGLE_PRIVATE_KEY = originalKey;
    process.env.GOOGLE_SPREADSHEET_ID = originalSheet;
  });

  it("validates webhook secrets and rejects missing or wrong values", () => {
    expect(verifyTelegramWebhookSecret("safe_secret-123", "safe_secret-123")).toBe(true);
    expect(verifyTelegramWebhookSecret("wrong", "safe_secret-123")).toBe(false);
    expect(verifyTelegramWebhookSecret(null, "safe_secret-123")).toBe(false);
    expect(verifyTelegramWebhookSecret("replace_with_value", "replace_with_value")).toBe(false);
  });

  it("does not report placeholder integrations as configured", () => {
    process.env.TELEGRAM_BOT_TOKEN = "replace_with_botfather_token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "replace_with_secret";
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "service@example.test";
    process.env.GOOGLE_PRIVATE_KEY = "replace_with_private_key";
    process.env.GOOGLE_SPREADSHEET_ID = "replace_with_spreadsheet_id";
    const readiness = getIntegrationReadiness();
    expect(readiness.find((item) => item.name === "Telegram")?.state).toBe("not-configured");
    expect(readiness.find((item) => item.name === "Google Sheets")?.state).toBe("not-configured");
  });

  it("keeps Telegram linking and notification retry manager-only", () => {
    expect(() => assertCanPerform("salesperson", "manage_telegram_links")).toThrow();
    expect(() => assertCanPerform("expense_reporter", "retry_notification")).toThrow();
    expect(() => assertCanPerform("manager", "manage_telegram_links")).not.toThrow();
    expect(() => assertCanPerform("manager", "retry_notification")).not.toThrow();
  });
});
