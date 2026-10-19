import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "../server/env";

/** Supabase client acting as the signed-in user (RLS applies). */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(serverEnv.supabaseUrl(), serverEnv.supabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}
