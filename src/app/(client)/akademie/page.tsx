import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import Link from "next/link";
import { GraduationCap, Clock, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = { title: "Akademie" };
export const dynamic = "force-dynamic";

interface Lesson {
  id: string;
  dauer: number | null;
}

interface Course {
  id: string;
  titel: string;
  beschreibung: string | null;
  reihenfolge: number;
  lessons: Lesson[];
}

interface Progress {
  lesson_id: string;
}

export default async function AkademiePage() {
  const profile = await requireAuth();
  const supabase = await createClient();

  const [coursesRes, progressRes] = await Promise.all([
    supabase
      .from("courses")
      .select("id, titel, beschreibung, reihenfolge, lessons(id, dauer)")
      .order("reihenfolge"),
    supabase
      .from("lesson_progress")
      .select("lesson_id")
      .eq("user_id", profile.id),
  ]);

  const courses = (coursesRes.data ?? []) as Course[];
  const completedIds = new Set(
    ((progressRes.data ?? []) as Progress[]).map((p) => p.lesson_id)
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Akademie</h1>
        <p className="text-sm text-muted-foreground">
          Lerne, wie du das Beste aus deinen Anfragen machst.
        </p>
      </div>

      {courses.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-12 text-center">
          <GraduationCap className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            Kurse werden in Kürze freigeschaltet.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {courses.map((course) => {
            const totalLessons = course.lessons.length;
            const doneLessons = course.lessons.filter((l) =>
              completedIds.has(l.id)
            ).length;
            const totalMinutes = course.lessons.reduce(
              (s, l) => s + (l.dauer ?? 0),
              0
            );

            return (
              <Link
                key={course.id}
                href={`/akademie/${course.id}`}
                className="rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
              >
                <div className="flex items-start justify-between">
                  <GraduationCap className="h-5 w-5 text-primary shrink-0" />
                  {doneLessons === totalLessons && totalLessons > 0 && (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  )}
                </div>
                <h2 className="mt-2 text-sm font-semibold">{course.titel}</h2>
                {course.beschreibung && (
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                    {course.beschreibung}
                  </p>
                )}
                <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {totalMinutes} Min.
                  </span>
                  <span className="font-mono">
                    {doneLessons}/{totalLessons} Lektionen
                  </span>
                </div>
                {totalLessons > 0 && (
                  <div className="mt-2 h-1.5 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{
                        width: `${(doneLessons / totalLessons) * 100}%`,
                      }}
                    />
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
