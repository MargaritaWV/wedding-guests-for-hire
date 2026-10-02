import { TransactionProcessor } from "@/src/application/transaction-processor";
import { getSupabaseAdminClient } from "@/src/integrations/supabase/admin-client";
import { SupabaseSideEffectQueue } from "@/src/integrations/supabase/side-effect-queue";
import { SupabaseTelegramLinkRepository } from "@/src/integrations/supabase/telegram-links";
import { SupabaseTransactionRepository } from "@/src/integrations/supabase/transaction-repository";
import { createTelegramGatewayIfConfigured } from "@/src/integrations/telegram/client";
import { createGoogleSheetsGatewayIfConfigured } from "@/src/integrations/google-sheets/gateway";

export function createServerServices() {
  const client = getSupabaseAdminClient();
  const repository = new SupabaseTransactionRepository(client);
  const telegramGateway = createTelegramGatewayIfConfigured();
  const googleSheetsGateway = createGoogleSheetsGatewayIfConfigured();
  const sideEffects = new SupabaseSideEffectQueue(client, telegramGateway, googleSheetsGateway);
  const telegramLinks = new SupabaseTelegramLinkRepository(client);
  const processor = new TransactionProcessor(repository, sideEffects);
  return {
    client,
    repository,
    sideEffects,
    telegramGateway,
    googleSheetsGateway,
    telegramLinks,
    processor,
  };
}
