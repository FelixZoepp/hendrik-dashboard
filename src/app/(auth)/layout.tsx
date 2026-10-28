import { LogoMark } from "@/components/layout/logo-mark";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark className="size-16 text-foreground" />
          <p className="mt-4 text-2xl font-semibold tracking-tight">Hoffmann Solutions</p>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-primary">Cloud</p>
        </div>
        {children}
      </div>
    </div>
  );
}
