import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { createServerSupabase } from "@/lib/supabase/server";

const EMAIL_LINK_TYPES: readonly EmailOtpType[] = ["email", "magiclink", "signup", "invite"];

/**
 * Sign-in lands here. Email links carry ?token_hash=…&type=… (works on any
 * device); Google sign-in carries ?code=… (must finish in the browser that started it).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = publicOrigin(request);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";

  if (tokenHash && type && EMAIL_LINK_TYPES.includes(type)) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL(safeNext, origin));
  } else if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", origin));
}
