import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import Link from "next/link";
import { ArrowLeft, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
    .from("sops")
    .select("titel")
    .eq("id", id)
    .single();

  return { title: data?.titel ?? "SOP" };
}

export default async function SopDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAuth();
  const supabase = await createClient();

  const { data: sop } = await supabase
    .from("sops")
    .select("*")
    .eq("id", id)
    .single();

  if (!sop) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/sops"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Zurück zur Bibliothek
      </Link>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="outline" className="text-[10px]">
            {sop.kategorie}
          </Badge>
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            v{sop.version}
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{sop.titel}</h1>
      </div>

      {/* Markdown-Inhalt als einfaches HTML rendern */}
      <div className="prose prose-sm prose-zinc max-w-none dark:prose-invert">
        {sop.inhalt.split("\n").map((line: string, i: number) => {
          if (line.startsWith("## "))
            return (
              <h2 key={i} className="text-lg font-semibold mt-6 mb-2">
                {line.slice(3)}
              </h2>
            );
          if (line.startsWith("### "))
            return (
              <h3 key={i} className="text-base font-medium mt-4 mb-1">
                {line.slice(4)}
              </h3>
            );
          if (line.startsWith("# "))
            return (
              <h2 key={i} className="text-lg font-semibold mt-6 mb-2">
                {line.slice(2)}
              </h2>
            );
          if (line.startsWith("- "))
            return (
              <li key={i} className="ml-4">
                {line.slice(2)}
              </li>
            );
          if (/^\d+\.\s/.test(line))
            return (
              <li key={i} className="ml-4 list-decimal">
                {line.replace(/^\d+\.\s/, "")}
              </li>
            );
          if (line.startsWith("**") && line.endsWith("**"))
            return (
              <p key={i} className="font-semibold mt-2">
                {line.slice(2, -2)}
              </p>
            );
          if (line.trim() === "") return <br key={i} />;
          return (
            <p key={i} className="leading-relaxed">
              {line}
            </p>
          );
        })}
      </div>
    </div>
  );
}
