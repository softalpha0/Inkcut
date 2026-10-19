import { isAdmin, usageSummary } from "@/lib/validation";
import { serverEnv } from "@/lib/server/env";
import { usageToday } from "@/lib/server/projects";
import { createServerSupabase } from "@/lib/supabase/server";
import { NewVideoForm } from "./NewVideoForm";

export const metadata = { title: "New video · Inkcut" };

export default async function NewVideoPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const usage = usageSummary(await usageToday(user!.id));
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-3xl">New video</h1>
      <p className="mt-1 text-ink-2">
        {usage.videosLeft} of {usage.videosPerDay} free videos left today.
      </p>
      <NewVideoForm
        canAnimate={isAdmin(user!.email, serverEnv.adminEmails())}
        videosLeft={usage.videosLeft}
      />
    </div>
  );
}
