import "server-only";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { z } from "zod";
import { createServerSupabase } from "../supabase/server";

export function json<T>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}

export function fail(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

/** The signed-in user, or null. */
export async function currentUser(): Promise<User | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T | Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Expected a JSON body");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid request");
  return parsed.data;
}
