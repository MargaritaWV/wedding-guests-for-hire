import { DomainError } from "@/src/domain/errors";
import { isConfiguredValue } from "@/src/integrations/config";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface TelegramBotIdentity {
  id: number;
  username: string;
  first_name: string;
}

export interface TelegramWebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_message?: string;
}

export interface TelegramGateway {
  sendMessage(chatId: string, text: string): Promise<void>;
  getMe(): Promise<TelegramBotIdentity>;
  getWebhookInfo(): Promise<TelegramWebhookInfo>;
  setWebhook(url: string, secretToken: string): Promise<void>;
}

function configuredToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!isConfiguredValue(token)) {
    throw new DomainError(
      "INTEGRATION_NOT_CONFIGURED",
      "Telegram is not configured. No message was sent.",
    );
  }
  return token!;
}

export function isTelegramConfigured(): boolean {
  return (
    isConfiguredValue(process.env.TELEGRAM_BOT_TOKEN) &&
    isConfiguredValue(process.env.TELEGRAM_WEBHOOK_SECRET)
  );
}

export function createTelegramGateway(): TelegramGateway {
  const token = configuredToken();

  async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
    } catch {
      throw new Error("Telegram could not be reached securely.");
    }

    const result = (await response.json()) as TelegramApiResponse<T>;
    if (!response.ok || !result.ok || result.result === undefined) {
      throw new Error(result.description ?? `Telegram returned HTTP ${response.status}.`);
    }
    return result.result;
  }

  return {
    async sendMessage(chatId: string, text: string): Promise<void> {
      await call("sendMessage", { chat_id: chatId, text });
    },
    getMe() {
      return call<TelegramBotIdentity>("getMe");
    },
    getWebhookInfo() {
      return call<TelegramWebhookInfo>("getWebhookInfo");
    },
    async setWebhook(url: string, secretToken: string): Promise<void> {
      await call("setWebhook", {
        url,
        secret_token: secretToken,
        allowed_updates: ["message"],
      });
    },
  };
}

export function createTelegramGatewayIfConfigured(): TelegramGateway | null {
  return isTelegramConfigured() ? createTelegramGateway() : null;
}
