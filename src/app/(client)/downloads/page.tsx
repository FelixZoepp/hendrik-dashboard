import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { Download, FileText, FolderOpen } from "lucide-react";

export const metadata: Metadata = { title: "Downloads" };
export const dynamic = "force-dynamic";

interface DownloadItem {
  id: string;
  titel: string;
  datei: string;
  kategorie: string;
}

export default async function DownloadsPage() {
  await requireAuth();
  const supabase = await createClient();

  const { data: downloads } = await supabase
    .from("downloads")
    .select("id, titel, datei, kategorie")
    .order("kategorie")
    .order("titel");

  const items = (downloads ?? []) as DownloadItem[];

  // Gruppieren
  const grouped = new Map<string, DownloadItem[]>();
  for (const item of items) {
    const list = grouped.get(item.kategorie) ?? [];
    list.push(item);
    grouped.set(item.kategorie, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Downloads</h1>
        <p className="text-sm text-muted-foreground">
          Checklisten, Vorlagen und Materialien für dich.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-12 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            Downloads werden in Kürze bereitgestellt.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([kategorie, categoryItems]) => (
            <div key={kategorie}>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                {kategorie}
              </h2>
              <div className="divide-y rounded-lg border bg-card">
                {categoryItems.map((item) => (
                  <a
                    key={item.id}
                    href={item.datei}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between px-3 py-2.5 text-sm transition-colors hover:bg-accent/50"
                  >
                    <div className="flex items-center gap-2.5">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{item.titel}</span>
                    </div>
                    <Download className="h-4 w-4 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
