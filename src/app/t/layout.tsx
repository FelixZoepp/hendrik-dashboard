import type { Metadata } from "next";
import { LogoMark } from "@/components/layout/logo-mark";

export const metadata: Metadata = {
  title: "Ihr Termin",
  robots: { index: false, follow: false },
};

export default function TerminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-muted">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-md items-center gap-2 px-4 py-3">
          <LogoMark className="size-8 text-foreground" />
          <span className="text-[15px] font-semibold tracking-tight">Hoffmann Solutions</span>
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-6">{children}</main>
    </div>
  );
}
