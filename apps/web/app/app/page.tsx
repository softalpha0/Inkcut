import Link from "next/link";
import { ACTIVE_STATUSES } from "@inkcut/shared";
import { Stickman } from "@/components/Stickman";
import { ButtonLink, Card, StatusBadge } from "@/components/ui";
import { AutoRefresh } from "@/components/AutoRefresh";
import { usageSummary } from "@/lib/validation";
import { usageToday } from "@/lib/server/projects";
import { adminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata = { title: "My videos · Inkcut" };

interface ListRow {
  id: string;
  title: string;
  status: string;
  aspect: string;
  created_at: string;
  output_expires_at: string | null;
}

function timeLeft(iso: string | null): string | null {
  if (!iso) return null;
  const hours = Math.round((new Date(iso).getTime() - Date.now()) / 3600_000);
  return hours > 0 ? `${hours} h left to download` : null;
}

export default async function Dashboard() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await adminSupabase()
    .from("projects")
    .select("id, title, status, aspect, created_at, output_expires_at")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const projects = (data ?? []) as ListRow[];
  const usage = usageSummary(await usageToday(user!.id));
  const anyActive = projects.some((p) => (ACTIVE_STATUSES as readonly string[]).includes(p.status));

  return (
    <div>
      <AutoRefresh active={anyActive} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">My videos</h1>
          <p className="mt-1 text-ink-2">
            <b>
              {usage.videosLeft} of {usage.videosPerDay}
            </b>{" "}
            free videos left today · {usage.redrawsLeft} redraws left
          </p>
        </div>
      </div>

      {projects.length === 0 ? (
        <Card className="mt-8 flex flex-col items-center gap-4 py-12 text-center">
          <Stickman pose="wave" size={110} />
          <h2 className="font-display text-2xl">No videos yet</h2>
          <p className="max-w-md text-ink-2">
            Start with a topic you know well. One minute is perfect for a first try.
          </p>
          <ButtonLink href="/app/new" variant="marker">
            Make my first video
          </ButtonLink>
        </Card>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/app/p/${p.id}`}
                className="block h-full rounded-2xl border-2 border-ink bg-white p-5 shadow-[4px_4px_0_0_var(--color-ink)] transition hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={p.status} />
                  <span className="text-xs font-semibold text-muted">{p.aspect}</span>
                </div>
                <h2 className="mt-3 line-clamp-2 font-display text-lg">{p.title}</h2>
                <p className="mt-2 text-xs text-muted">
                  {new Date(p.created_at).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}
                  {p.status === "done" && timeLeft(p.output_expires_at)
                    ? ` · ${timeLeft(p.output_expires_at)}`
                    : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
