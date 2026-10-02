import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DomainError } from "@/src/domain/errors";

let cachedClient: SupabaseClient | null = null;

/** Server-only administrative client. Never import this module into a client component. */
export function getSupabaseAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    throw new DomainError(
      "INTEGRATION_NOT_CONFIGURED",
      "Supabase server credentials are not configured.",
    );
  }

  cachedClient ??= createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}
