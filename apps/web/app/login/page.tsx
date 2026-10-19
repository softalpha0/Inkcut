import { Logo } from "@/components/Logo";
import { Stickman } from "@/components/Stickman";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Inkcut" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <div className="paper-dots grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-3xl border-2 border-ink bg-white p-7 shadow-[6px_6px_0_0_var(--color-ink)]">
          <div className="flex items-end gap-3">
            <Stickman pose="wave" size={80} />
            <div>
              <h1 className="font-display text-2xl">Welcome to Inkcut</h1>
              <p className="text-sm text-ink-2">Sign in or create a free account.</p>
            </div>
          </div>
          {error ? (
            <p className="mt-5 rounded-xl bg-[#ffe1db] px-3 py-2 text-sm text-[#9b2c17]">
              That sign-in link expired or was already used. Send a new one.
            </p>
          ) : null}
          <LoginForm next={next && next.startsWith("/") ? next : "/app"} />
        </div>
      </div>
    </div>
  );
}
