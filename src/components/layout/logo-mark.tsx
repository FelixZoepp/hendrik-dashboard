/** Hoffman-Logo (HS-Monogramm) als SVG — nachgezeichnet nach public/logo.png. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" fill="none" strokeWidth={3.4}>
      {/* oberer Bogen + linker Querstrich (schwarz) */}
      <path d="M5.5 50 H30 M5.5 50 A44.5 44.5 0 0 1 86.6 24.4" stroke="currentColor" />
      {/* H-Stämme */}
      <path d="M34 23 V46.5 M34 51 V77 M67 23 V46.5 M67 51 V77" stroke="currentColor" />
      {/* Querbalken + unterer Bogen (blau) */}
      <path d="M33 50 H94.5 A44.5 44.5 0 0 1 15.4 78.6" stroke="#0b4aa8" />
    </svg>
  );
}
