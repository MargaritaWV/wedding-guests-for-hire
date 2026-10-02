import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServerServices } from "../src/application/server-services";

const live = process.env.RUN_LIVE_TELEGRAM_LINK_TESTS === "1";
const suite = live ? describe : describe.skip;

suite("live Supabase Telegram-link smoke test", () => {
  const telegramUserId = `8${Date.now()}`;
  const privateChatId = `7${Date.now()}`;

  beforeAll(() => {
    process.loadEnvFile?.(".env.local");
  });

  afterAll(async () => {
    if (!live) return;
    const { client } = createServerServices();
    await client.from("telegram_employee_links").delete().eq("telegram_user_id", telegramUserId);
  });

  it("links only as manager, records the private chat, and supports relinking", async () => {
    const { repository, telegramLinks } = createServerServices();
    const manager = await repository.resolveActor("svetlana");
    const salesperson = await repository.resolveActor("richard");

    await expect(
      telegramLinks.linkUser(salesperson, telegramUserId, "richard"),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

    await telegramLinks.linkUser(manager, telegramUserId, "richard");
    const firstActor = await telegramLinks.resolveActorByTelegramUser(
      telegramUserId,
      privateChatId,
    );
    expect(firstActor?.employeeCode).toBe("richard");

    await telegramLinks.linkUser(manager, telegramUserId, "kevin");
    const relinkedActor = await telegramLinks.resolveActorByTelegramUser(
      telegramUserId,
      privateChatId,
    );
    expect(relinkedActor?.employeeCode).toBe("kevin");

    const link = (await telegramLinks.listLinks()).find(
      (candidate) => candidate.telegramUserId === telegramUserId,
    );
    expect(link).toMatchObject({ employeeCode: "kevin", hasPrivateChat: true });
  }, 60_000);
});
