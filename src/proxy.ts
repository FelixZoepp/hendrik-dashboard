import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { ANSICHT_COOKIE, ROLLEN_ANSICHT_COOKIE, entscheideZugriff, istOeffentlicherPfad, wirksameRolle, type Rolle } from "@/lib/zugriff";

async function ladeProfil(userId: string): Promise<{ rolle: Rolle; aktiv: boolean } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const db = createSupabaseClient(url, key, { auth: { persistSession: false } });
  const { data } = await db.from("profiles").select("role, active").eq("id", userId).maybeSingle();
  if (!data) return null;
  return { rolle: data.role as Rolle, aktiv: data.active === true };
}

export async function proxy(request: NextRequest) {
  const pfad = request.nextUrl.pathname;

  // Webhooks, Crons, Token-Links, Dateien: ohne Session-Abgleich durchlassen
  if (istOeffentlicherPfad(pfad) && pfad !== "/login") {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  // Nichts zwischen createServerClient und getUser — sonst zufällige Abmeldungen.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const echtesProfil = user ? await ladeProfil(user.id) : null;
  const profil = echtesProfil && {
    ...echtesProfil,
    rolle: wirksameRolle(echtesProfil.rolle, request.cookies.get(ROLLEN_ANSICHT_COOKIE)?.value),
  };
  const entscheidung = entscheideZugriff({
    pfad,
    vollerPfad: pfad + request.nextUrl.search,
    angemeldet: !!user,
    profil,
    ansichtGesetzt: !!request.cookies.get(ANSICHT_COOKIE)?.value,
  });

  const mitCookies = (ziel: NextResponse) => {
    response.cookies.getAll().forEach((c) => ziel.cookies.set(c));
    return ziel;
  };

  switch (entscheidung.typ) {
    case "weiter":
      return response;
    case "umleiten":
      return mitCookies(NextResponse.redirect(new URL(entscheidung.ziel, request.url)));
    case "abmelden": {
      await supabase.auth.signOut();
      const ziel = mitCookies(NextResponse.redirect(new URL(entscheidung.ziel, request.url)));
      ziel.cookies.delete(ANSICHT_COOKIE);
      ziel.cookies.delete(ROLLEN_ANSICHT_COOKIE);
      return ziel;
    }
    case "nicht_angemeldet":
      return mitCookies(NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 }));
    case "verboten":
      return mitCookies(NextResponse.json({ error: "Kein Zugriff" }, { status: 403 }));
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|pdf|txt|xml|webmanifest|woff2?)$).*)",
  ],
};
