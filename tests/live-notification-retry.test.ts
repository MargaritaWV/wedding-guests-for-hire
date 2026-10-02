import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TransactionProcessor } from "../src/application/transaction-processor";
import { calculateFinancialSummary } from "../src/domain/calculations";
import { getSupabaseAdminClient } from "../src/integrations/supabase/admin-client";
import { SupabaseSideEffectQueue } from "../src/integrations/supabase/side-effect-queue";
import { SupabaseTelegramLinkRepository } from "../src/integrations/supabase/telegram-links";
import { SupabaseTransactionRepository } from "../src/integrations/supabase/transaction-repository";
import type { TelegramGateway } from "../src/integrations/telegram/client";

const live = process.env.RUN_LIVE_NOTIFICATION_RETRY_TESTS === "1";
const suite = live ? describe : describe.skip;

suite("live notification failure and retry smoke test", () => {
  const suffix = `${Date.now()}`;
  const reference = `TMP_NOTIFY_${suffix}`;
  const telegramUserId = `8${suffix}`;
  const privateChatId = `7${suffix}`;
  let transactionId: string | null = null;

  beforeAll(() => {
    process.loadEnvFile?.(".env.local");
  });

  afterAll(async () => {
    if (!live) return;
    const client = getSupabaseAdminClient();
    if (transactionId) {
      await client.from("notification_jobs").delete().eq("transaction_id", transactionId);
      await client.from("google_sheet_sync_jobs").delete().eq("transaction_id", transactionId);
      await client.from("manager_decisions").delete().eq("transaction_id", transactionId);
      await client.from("sales").delete().eq("transaction_id", transactionId);
      await client.from("transactions").delete().eq("id", transactionId);
    }
    await client.from("telegram_employee_links").delete().eq("telegram_user_id", telegramUserId);
  });

  it("keeps the approval, records failure, and retries without changing totals", async () => {
    const client = getSupabaseAdminClient();
    const repository = new SupabaseTransactionRepository(client);
    const links = new SupabaseTelegramLinkRepository(client);
    const manager = await repository.resolveActor("svetlana");
    const richard = await repository.resolveActor("richard");
    await links.linkUser(manager, telegramUserId, "richard");
    await links.resolveActorByTelegramUser(telegramUserId, privateChatId);

    let attempts = 0;
    const telegram: TelegramGateway = {
      async sendMessage() {
        attempts += 1;
        if (attempts === 1) throw new Error("Temporary mocked Telegram failure");
      },
      async getMe() {
        return { id: 1, username: "test", first_name: "test" };
      },
      async getWebhookInfo() {
        return { url: "", pending_update_count: 0 };
      },
      async setWebhook() {},
    };
    const sideEffects = new SupabaseSideEffectQueue(client, telegram);
    const processor = new TransactionProcessor(repository, sideEffects);

    const sale = await processor.submitSale(richard, { origin: "website" }, {
      reference,
      customer: "Temporary notification test",
      project: "A",
      description: "Removed automatically",
      amountCents: 10_000,
      proposedSplit: { richard: 50, anastasia: 30, jeanClaude: 20 },
    });
    transactionId = sale.transactionId;
    const approval = await processor.approveSale(manager, {
      transactionId,
      finalSplit: { richard: 40, anastasia: 30, jeanClaude: 30 },
    });
    expect(approval.transitioned).toBe(true);

    const { data: failedJob } = await client
      .from("notification_jobs")
      .select("state,attempt_count")
      .eq("transaction_id", transactionId)
      .eq("kind", "SALE_APPROVAL_DECISION")
      .single();
    expect(failedJob).toMatchObject({ state: "FAILED", attempt_count: 1 });

    const beforeRetry = await repository.getSnapshot(manager);
    const beforeSummary = calculateFinancialSummary(
      beforeRetry.sales.filter((record) => record.reference === reference),
      [],
    );
    expect(await sideEffects.retryNotification(
      manager,
      transactionId,
      "SALE_APPROVAL_DECISION",
    )).toBe("SENT");

    const afterRetry = await repository.getSnapshot(manager);
    const afterSummary = calculateFinancialSummary(
      afterRetry.sales.filter((record) => record.reference === reference),
      [],
    );
    expect(afterSummary.totalCompanyResultCents).toBe(beforeSummary.totalCompanyResultCents);
    expect(attempts).toBe(2);
  }, 60_000);
});
