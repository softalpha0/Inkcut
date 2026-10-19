import "server-only";

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const serverEnv = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  serviceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  redisUrl: () => required("REDIS_URL"),
  adminEmails: () => process.env.ADMIN_EMAILS ?? "",
  siteUrl: () => process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "",
};
