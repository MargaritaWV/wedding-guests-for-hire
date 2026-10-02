import { createServerServices } from "@/src/application/server-services";
import type { TelegramUpdate } from "@/src/integrations/telegram/handler";
import { TelegramUpdateHandler } from "@/src/integrations/telegram/handler";
import { verifyTelegramWebhookSecret } from "@/src/integrations/telegram/webhook-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!verifyTelegramWebhookSecret(suppliedSecret)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 100_000) {
    return Response.json({ ok: false }, { status: 413 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  try {
    const { processor, telegramGateway, telegramLinks } = createServerServices();
    if (!telegramGateway) return Response.json({ ok: false }, { status: 503 });
    await new TelegramUpdateHandler(processor, telegramLinks, telegramGateway).handle(update);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
