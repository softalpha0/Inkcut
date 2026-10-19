import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Applies the migration to a throwaway Postgres (with a Supabase stand-in) and checks RLS
 * and the daily limit function. Runs only when INKCUT_TEST_PG is set, e.g.
 * INKCUT_TEST_PG="-h /tmp/pg -p 55432 -U postgres".
 */
const pgArgs = process.env.INKCUT_TEST_PG?.split(" ").filter(Boolean);
const here = path.dirname(fileURLToPath(import.meta.url));
const migration = path.join(here, "..", "migrations", "0001_init.sql");
const stub = path.join(here, "supabase-stub.sql");

function psql(args: string[], input?: string): string {
  const r = spawnSync("psql", [...pgArgs!, "-v", "ON_ERROR_STOP=1", "-qAt", ...args], {
    input,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
}

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const asUser = (uid: string, sql: string) =>
  psql(
    ["-d", "inkcut_test"],
    `begin; set local role authenticated; set local request.jwt.claim.sub = '${uid}'; ${sql}; commit;`,
  );

describe.skipIf(!pgArgs)("0001_init.sql", () => {
  it("applies cleanly twice and enforces RLS and daily limits", () => {
    psql(["-d", "postgres", "-c", "drop database if exists inkcut_test"]);
    psql(["-d", "postgres", "-c", "create database inkcut_test"]);
    psql(["-d", "inkcut_test", "-f", stub]);
    psql(["-d", "inkcut_test", "-f", migration]);
    psql(["-d", "inkcut_test", "-f", migration]); // idempotent

    psql(
      ["-d", "inkcut_test"],
      `insert into auth.users (id, email) values ('${A}', 'a@x'), ('${B}', 'b@x');`,
    );
    expect(psql(["-d", "inkcut_test", "-c", "select count(*) from public.profiles"])).toBe("2");
    expect(
      psql(["-d", "inkcut_test", "-c", "select string_agg(id, ',' order by id) from storage.buckets"]),
    ).toBe("assets,outputs,uploads");
    expect(
      psql([
        "-d",
        "inkcut_test",
        "-c",
        "select count(*) from pg_publication_tables where pubname='supabase_realtime'",
      ]),
    ).toBe("2");

    // A creates a project; B cannot see or change it.
    asUser(
      A,
      `insert into public.projects (user_id, input_mode, topic, minutes) values ('${A}', 'topic', 'x', 1)`,
    );
    expect(asUser(A, "select count(*) from public.projects")).toContain("1");
    expect(asUser(B, "select count(*) from public.projects")).toContain("0");
    expect(() =>
      asUser(B, `insert into public.projects (user_id, input_mode, topic) values ('${A}', 'topic', 'spoof')`),
    ).toThrow(/row-level security/);

    // Limits are atomic and only callable by the service role.
    const bump = () =>
      psql(
        ["-d", "inkcut_test"],
        `set role service_role; select public.bump_usage('${A}', 'videos_started', 3);`,
      );
    expect([bump(), bump(), bump(), bump()]).toEqual(["1", "2", "3", "-1"]);
    expect(() => asUser(A, `select public.bump_usage('${A}', 'redraws', 30)`)).toThrow(/permission denied/);
  });
});
