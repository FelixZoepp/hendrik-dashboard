import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { ProjectDetail } from "./project-detail";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("typ, companies(name)")
    .eq("id", id)
    .single();

  const project = data as { typ: string; companies: { name: string } } | null;
  return {
    title: project
      ? `${project.companies?.name} — ${project.typ}`
      : "Projekt",
  };
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireRole(["admin", "fulfillment"]);
  const supabase = await createClient();

  const [projectRes, sopsRes] = await Promise.all([
    supabase
      .from("projects")
      .select("*, project_tasks(*, sops(id, titel)), companies(name)")
      .eq("id", id)
      .single(),
    supabase.from("sops").select("id, titel, kategorie"),
  ]);

  if (!projectRes.data) notFound();

  return (
    <ProjectDetail
      project={projectRes.data}
      sops={sopsRes.data ?? []}
    />
  );
}
