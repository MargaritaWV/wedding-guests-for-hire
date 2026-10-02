export type ReadinessState = "not-configured" | "configured-unverified" | "connected";

export interface IntegrationReadiness {
  name: "Supabase" | "Telegram" | "Google Sheets";
  state: ReadinessState;
  label: string;
  detail: string;
  href?: string;
}

export function isConfiguredValue(value: string | undefined): boolean {
  const normalized = value?.trim() ?? "";
  return Boolean(normalized) && !/replace_with|your_|placeholder|example/i.test(normalized);
}

function readiness(
  name: IntegrationReadiness["name"],
  variablesPresent: boolean,
  configuredDetail: string,
): IntegrationReadiness {
  return variablesPresent
    ? {
        name,
        state: "configured-unverified",
        label: "Configuration supplied, not verified",
        detail: configuredDetail,
      }
    : {
        name,
        state: "not-configured",
        label: "Not configured",
        detail: "No connection is claimed. Add the required server-side environment values later.",
      };
}

export function getIntegrationReadiness(options?: {
  supabaseConnected?: boolean;
  telegramConnected?: boolean;
  googleSheetsConnected?: boolean;
}): IntegrationReadiness[] {
  const supabase = options?.supabaseConnected
    ? {
        name: "Supabase" as const,
        state: "connected" as const,
        label: "Connected",
        detail: "The server successfully verified the homework database and employee records.",
      }
    : readiness(
        "Supabase",
        isConfiguredValue(process.env.SUPABASE_URL) &&
          isConfiguredValue(process.env.SUPABASE_SERVICE_ROLE_KEY),
        "The server variables exist. A database connection test is still required.",
      );

  return [
    supabase,
    options?.telegramConnected
      ? {
          name: "Telegram" as const,
          state: "connected" as const,
          label: "Connected and verified",
          detail: "The real bot token and secure webhook are active.",
        }
      : readiness(
          "Telegram",
          isConfiguredValue(process.env.TELEGRAM_BOT_TOKEN) &&
            isConfiguredValue(process.env.TELEGRAM_WEBHOOK_SECRET),
          "The bot variables exist. The bot and webhook are not marked connected until tested.",
        ),
    options?.googleSheetsConnected
      ? {
          name: "Google Sheets" as const,
          state: "connected" as const,
          label: "Connected and verified",
          detail: "Sales and Expenses are synchronized automatically from Supabase.",
          href: googleSpreadsheetUrl() ?? undefined,
        }
      : readiness(
          "Google Sheets",
          isConfiguredValue(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) &&
            isConfiguredValue(process.env.GOOGLE_PRIVATE_KEY) &&
            isConfiguredValue(process.env.GOOGLE_SPREADSHEET_ID),
          "The service-account variables exist. Spreadsheet access is not marked connected until tested.",
        ),
  ];
}

export function googleSpreadsheetUrl(): string | null {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID?.trim();
  if (!spreadsheetId || !isConfiguredValue(spreadsheetId)) return null;
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;
}
