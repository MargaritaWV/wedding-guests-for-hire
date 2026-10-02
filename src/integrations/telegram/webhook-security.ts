import { timingSafeEqual } from "node:crypto";
import { isConfiguredValue } from "@/src/integrations/config";

export function verifyTelegramWebhookSecret(
  received: string | null,
  expected = process.env.TELEGRAM_WEBHOOK_SECRET,
): boolean {
  if (!received || !isConfiguredValue(expected)) return false;
  const receivedBytes = Buffer.from(received, "utf8");
  const expectedBytes = Buffer.from(expected!.trim(), "utf8");
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}
