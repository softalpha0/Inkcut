import Link from "next/link";
import type { ComponentProps } from "react";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl border-2 border-ink px-5 py-2.5 font-display text-base transition active:translate-x-[2px] active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-50";

const variants = {
  primary: "bg-ink text-paper shadow-[3px_3px_0_0_var(--color-marker)] hover:-translate-y-0.5",
  marker: "bg-marker text-ink shadow-[3px_3px_0_0_var(--color-ink)] hover:-translate-y-0.5",
  ghost: "bg-white text-ink hover:bg-paper-2",
} as const;

type Variant = keyof typeof variants;

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Card({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <div
      className={`rounded-2xl border-2 border-ink bg-white p-5 shadow-[4px_4px_0_0_var(--color-ink)] ${className}`}
      {...props}
    />
  );
}

const STATUS_STYLE: Record<string, string> = {
  done: "bg-[#d9f5e9] text-[#0e6b4c]",
  failed: "bg-[#ffe1db] text-[#9b2c17]",
  draft: "bg-paper-2 text-ink-2",
  expired: "bg-paper-2 text-muted",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  queued: "Queued",
  scripting: "Writing script",
  transcribing: "Transcribing",
  planning: "Planning scenes",
  voicing: "Recording voice",
  drawing: "Drawing",
  animating: "Animating",
  rendering: "Rendering",
  done: "Ready",
  failed: "Failed",
  expired: "Expired",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? "bg-marker/60 text-ink";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${style}`}
    >
      {STATUS_STYLE[status] ? null : <span className="size-1.5 animate-pulse rounded-full bg-ink" />}
      {statusLabel(status)}
    </span>
  );
}
