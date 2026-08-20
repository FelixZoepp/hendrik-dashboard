import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { CourseDetail } from "./course-detail";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ courseId: string }>;
}): Promise<Metadata> {
  const { courseId } = await params;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("courses")
    .select("titel")
    .eq("id", courseId)
    .single();
  return { title: data?.titel ?? "Kurs" };
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const userId = "";
  const supabase = createAdminClient();

  const [courseRes, progressRes] = await Promise.all([
    supabase
      .from("courses")
      .select(
        "id, titel, beschreibung, lessons(id, titel, beschreibung, video_url, dauer, reihenfolge, freigeschaltet_ab)"
      )
      .eq("id", courseId)
      .single(),
    supabase
      .from("lesson_progress")
      .select("lesson_id, abgeschlossen_am")
      .eq("user_id", userId),
  ]);

  if (!courseRes.data) notFound();

  return (
    <CourseDetail
      course={courseRes.data}
      progress={progressRes.data ?? []}
      userId={userId}
    />
  );
}
