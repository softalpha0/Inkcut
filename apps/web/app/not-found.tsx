import { Stickman } from "@/components/Stickman";
import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="paper-dots grid min-h-screen place-items-center px-4">
      <div className="flex flex-col items-center gap-4 text-center">
        <Stickman pose="think" size={120} />
        <h1 className="font-display text-3xl">Nothing drawn here yet</h1>
        <p className="text-ink-2">That page doesn&apos;t exist, or it isn&apos;t yours.</p>
        <ButtonLink href="/">Back home</ButtonLink>
      </div>
    </div>
  );
}
