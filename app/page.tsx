import { FinanceApp } from "@/app/components/finance-app";
import { calculateFinancialSummary } from "@/src/domain/calculations";
import { EMPLOYEE_CODES, type EmployeeCode } from "@/src/domain/employees";
import { createServerServices } from "@/src/application/server-services";
import type { FinanceSnapshot, TelegramLinkView } from "@/src/application/read-models";
import { getIntegrationReadiness } from "@/src/integrations/config";
import { createTelegramGatewayIfConfigured } from "@/src/integrations/telegram/client";
import { createGoogleSheetsGatewayIfConfigured } from "@/src/integrations/google-sheets/gateway";

export const dynamic = "force-dynamic";

function selectedEmployee(value: string | string[] | undefined): EmployeeCode | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && EMPLOYEE_CODES.includes(candidate as EmployeeCode)
    ? (candidate as EmployeeCode)
    : null;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ role?: string | string[] }>;
}) {
  const role = selectedEmployee((await searchParams).role);
  let connected = false;
  let snapshot: FinanceSnapshot = { sales: [], expenses: [] };
  let telegramLinks: TelegramLinkView[] = [];
  let databaseMessage: string | null = null;
  let telegramConnected = false;
  let googleSheetsConnected = false;
  let telegramBotUsername: string | null = null;

  try {
    const { repository, telegramLinks: linkRepository } = createServerServices();
    await repository.verifyConnection();
    connected = true;
    if (role) {
      const actor = await repository.resolveActor(role);
      snapshot = await repository.getSnapshot(actor);
      if (actor.role === "manager") telegramLinks = await linkRepository.listLinks();
    }
  } catch {
    databaseMessage =
      "The database could not be reached safely. Check the server configuration and try again.";
  }

  try {
    const telegram = createTelegramGatewayIfConfigured();
    if (telegram) {
      const [bot, webhook] = await Promise.all([telegram.getMe(), telegram.getWebhookInfo()]);
      telegramBotUsername = bot.username;
      telegramConnected = Boolean(webhook.url) && !webhook.last_error_message;
    }
  } catch {
    // Telegram remains unverified without exposing connection details to the page.
  }

  try {
    const sheets = createGoogleSheetsGatewayIfConfigured();
    if (sheets) {
      await sheets.verifyConnection();
      googleSheetsConnected = true;
    }
  } catch {
    // Google Sheets remains unverified without exposing connection details to the page.
  }

  const summary = calculateFinancialSummary(snapshot.sales, snapshot.expenses);

  return (
    <FinanceApp
      selectedRole={role}
      snapshot={snapshot}
      summary={summary}
      telegramLinks={telegramLinks}
      telegramBotUsername={telegramBotUsername}
      readiness={getIntegrationReadiness({
        supabaseConnected: connected,
        telegramConnected,
        googleSheetsConnected,
      })}
      databaseMessage={databaseMessage}
    />
  );
}
