import { isAdmin, usageSummary } from "@/lib/validation";
import { currentUser, fail, json } from "@/lib/server/http";
import { serverEnv } from "@/lib/server/env";
import { usageToday } from "@/lib/server/projects";

/** GET /api/me: who is signed in, what they can use today. */
export async function GET() {
  const user = await currentUser();
  if (!user) return fail(401, "Sign in first");
  return json({
    email: user.email,
    canAnimate: isAdmin(user.email, serverEnv.adminEmails()),
    usage: usageSummary(await usageToday(user.id)),
  });
}
