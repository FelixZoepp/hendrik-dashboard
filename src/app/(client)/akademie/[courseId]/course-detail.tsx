"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  Play,
  Lock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

interface Lesson {
  id: string;
  titel: string;
  beschreibung: string | null;
  video_url: string | null;
  dauer: number | null;
  reihenfolge: number;
  freigeschaltet_ab: number;
}

interface Progress {
  lesson_id: string;
  abgeschlossen_am: string;
}

interface CourseDetailProps {
  course: {
    id: string;
    titel: string;
    beschreibung: string | null;
    lessons: Lesson[];
  };
  progress: Progress[];
  userId: string;
}

export function CourseDetail({
  course,
  progress,
  userId,
}: CourseDetailProps) {
  const router = useRouter();
  const completedIds = new Set(progress.map((p) => p.lesson_id));
  const lessons = [...course.lessons].sort(
    (a, b) => a.reihenfolge - b.reihenfolge
  );

  async function markComplete(lessonId: string) {
    const supabase = createClient();
    const { error } = await supabase.from("lesson_progress").upsert({
      user_id: userId,
      lesson_id: lessonId,
    });

    if (error) {
      toast.error("Fehler beim Speichern");
      return;
    }

    toast.success("Lektion abgeschlossen!");
    router.refresh();
  }

  async function markIncomplete(lessonId: string) {
    const supabase = createClient();
    await supabase
      .from("lesson_progress")
      .delete()
      .eq("user_id", userId)
      .eq("lesson_id", lessonId);

    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/akademie"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Alle Kurse
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{course.titel}</h1>
        {course.beschreibung && (
          <p className="mt-1 text-sm text-muted-foreground">
            {course.beschreibung}
          </p>
        )}
      </div>

      <div className="divide-y rounded-lg border bg-card">
        {lessons.map((lesson) => {
          const done = completedIds.has(lesson.id);
          // Freischaltung: freigeschaltet_ab = 0 heißt sofort verfügbar
          // In einer vollen Implementierung würde man das gegen company.start_datum prüfen
          const locked = false; // TODO: gegen Onboarding-Datum prüfen

          return (
            <div
              key={lesson.id}
              className={cn(
                "flex items-start gap-3 px-4 py-3",
                locked && "opacity-50"
              )}
            >
              {locked ? (
                <Lock className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
              ) : done ? (
                <button
                  onClick={() => markIncomplete(lesson.id)}
                  className="mt-0.5 shrink-0"
                >
                  <CheckCircle2 className="h-4 w-4 text-success" />
                </button>
              ) : (
                <button
                  onClick={() => markComplete(lesson.id)}
                  className="mt-0.5 shrink-0"
                >
                  <Circle className="h-4 w-4 text-muted-foreground hover:text-primary transition-colors" />
                </button>
              )}

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    done && "line-through text-muted-foreground"
                  )}
                >
                  {lesson.titel}
                </p>
                {lesson.beschreibung && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {lesson.beschreibung}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  {lesson.dauer && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {lesson.dauer} Min.
                    </span>
                  )}
                  {lesson.freigeschaltet_ab > 0 && (
                    <span>Ab Tag {lesson.freigeschaltet_ab}</span>
                  )}
                </div>
              </div>

              {lesson.video_url && !locked && (
                <Button
                  variant="ghost"
                  size="icon"
                  render={
                    <a
                      href={lesson.video_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                  className="shrink-0"
                >
                  <Play className="h-4 w-4" />
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
