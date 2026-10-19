import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client: bypasses RLS. Only for the worker and server-side API routes,
 * never for browser code (spec §Security).
 */
export function createServiceClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type { SupabaseClient };
