import "server-only";
import { createServiceClient, type SupabaseClient } from "@inkcut/db";
import { serverEnv } from "../server/env";

let client: SupabaseClient | undefined;

/** Service-role client for API routes only (never imported by client components). */
export function adminSupabase(): SupabaseClient {
  client ??= createServiceClient(serverEnv.supabaseUrl(), serverEnv.serviceRoleKey());
  return client;
}
