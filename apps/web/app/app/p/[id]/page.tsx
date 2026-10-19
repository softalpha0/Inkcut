import { notFound } from "next/navigation";
import { getOwnedProject } from "@/lib/server/projects";
import { createServerSupabase } from "@/lib/supabase/server";
import { ProjectView } from "./ProjectView";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const project = await getOwnedProject(id, user!.id);
  if (!project) notFound();
  return <ProjectView id={project.id} />;
}
