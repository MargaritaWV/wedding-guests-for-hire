import { NextResponse } from "next/server";
import { createServerServices } from "@/src/application/server-services";
import { getIntegrationReadiness } from "@/src/integrations/config";
import { createTelegramGatewayIfConfigured } from "@/src/integrations/telegram/client";
import { createGoogleSheetsGatewayIfConfigured } from "@/src/integrations/google-sheets/gateway";

export const dynamic = "force-dynamic";

export async function GET() {
  let supabaseConnected = false;
  let telegramConnected = false;
  let googleSheetsConnected = false;
  try {
    const { repository } = createServerServices();
    await repository.verifyConnection();
    supabaseConnected = true;
  } catch {
    // The response reports a safe readiness state without returning connection details.
  }
  try {
    const telegram = createTelegramGatewayIfConfigured();
    if (telegram) {
      const webhook = await telegram.getWebhookInfo();
      telegramConnected = Boolean(webhook.url) && !webhook.last_error_message;
    }
  } catch {
    // The response remains honest without exposing connection details.
  }
  try {
    const sheets = createGoogleSheetsGatewayIfConfigured();
    if (sheets) {
      await sheets.verifyConnection();
      googleSheetsConnected = true;
    }
  } catch {
    // The response remains honest without exposing connection details.
  }
  return NextResponse.json({
    services: getIntegrationReadiness({
      supabaseConnected,
      telegramConnected,
      googleSheetsConnected,
    }),
  });
}
