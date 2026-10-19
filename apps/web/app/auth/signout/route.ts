import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/origin";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", publicOrigin(request)), 303);
}
