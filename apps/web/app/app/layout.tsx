import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { ButtonLink } from "@/components/ui";
import { createServerSupabase } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app");

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b-2 border-ink bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Logo href="/app" />
          <div className="flex items-center gap-3">
            <ButtonLink href="/app/new" className="px-4 py-2 text-sm">
              + New video
            </ButtonLink>
            <span className="hidden max-w-48 truncate text-sm text-muted sm:block">{user.email}</span>
            <form action="/auth/signout" method="post">
              <button className="text-sm font-semibold text-ink-2 underline-offset-4 hover:underline">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
