import Link from "next/link";

/** Ink drop + cut line: the Inkcut mark. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3c4.5 6 9 10.6 9 15.5A9 9 0 0 1 7 18.5C7 13.6 11.5 9 16 3Z" fill="var(--color-ink)" />
      <path d="M4 25 28 14" stroke="var(--color-marker)" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-display text-xl tracking-tight text-ink">
      <LogoMark />
      Inkcut
    </Link>
  );
}
