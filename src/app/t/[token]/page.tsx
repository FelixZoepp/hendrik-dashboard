import { CalendarPlus, CheckCircle2, Clock, MapPin, PlayCircle, Video } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { terminBasisUrl } from "@/lib/whatsapp/client";
import { ladeEinstellungen } from "@/lib/whatsapp/einstellungen";
import { istDirektesVideo, videoEinbettung } from "@/lib/whatsapp/gate";
import { googleLink, office365Link, outlookLink, yahooLink } from "@/lib/whatsapp/kalender";
import { formatUhrzeit, TZ } from "@/lib/whatsapp/logik";
import { ladeTerminPerToken, type Termin } from "@/lib/whatsapp/termine";

export const dynamic = "force-dynamic";

const KNOPF =
  "flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-medium transition-transform active:translate-y-px";
const KNOPF_PRIMAER = `${KNOPF} fern-btn-primary text-primary-foreground shadow-sm`;
const KNOPF_SEKUNDAER = `${KNOPF} bg-card text-foreground shadow-[inset_0_0_0_1.5px_var(--border)]`;

/**
 * Öffentliche Termin-Seite hinter den Knöpfen der WhatsApp-Nachrichten.
 * Bewusst ohne personenbezogene Daten: kein Name, keine Telefonnummer/E-Mail, Ort nur generisch.
 */
export default async function TerminSeite({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const svc = createAdminClient();
  const termin = await ladeTerminPerToken(svc, token);

  if (!termin) {
    return (
      <Hinweis titel="Termin nicht gefunden">
        Der Link ist ungültig oder der Termin wurde geändert. Antworten Sie uns einfach kurz per WhatsApp.
      </Hinweis>
    );
  }

  const vorbei = new Date(termin.start_at).getTime() < new Date().getTime() - 60 * 60_000;
  if (termin.status !== "geplant" || vorbei) {
    const text =
      termin.status === "abgesagt"
        ? "Dieser Termin wurde abgesagt."
        : termin.status === "verpasst"
          ? "Wir haben Sie zu diesem Termin leider nicht erreicht."
          : "Dieser Termin liegt bereits zurück.";
    return (
      <Hinweis titel={text}>
        Sie möchten einen neuen Termin?{" "}
        <a href={`/n/${termin.token}`} className="font-medium text-primary underline underline-offset-4">
          Hier können Sie ihn auswählen.
        </a>
      </Hinweis>
    );
  }

  const einstellungen = await ladeEinstellungen(svc);
  return <TerminInhalt termin={termin} video={einstellungen.videos[termin.art]} />;
}

function Hinweis({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <div className="fern-card p-6">
      <h1 className="text-2xl font-semibold tracking-tight">{titel}</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">{children}</p>
    </div>
  );
}

function TerminInhalt({ termin, video }: { termin: Termin; video: string | null }) {
  const start = new Date(termin.start_at);
  const tag = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(start);
  const kalender = {
    id: termin.id,
    art: termin.art,
    start_at: termin.start_at,
    ende_at: termin.ende_at,
    ort_text: termin.ort_text,
    join_url: termin.join_url,
    seitenUrl: `${terminBasisUrl()}/t/${termin.token}`,
  };

  return (
    <div className="space-y-4">
      <div className="fern-card p-6">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">Ihr Termin mit der Hoffmann Solutions GmbH</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {termin.art === "strategie" ? "Strategiegespräch" : "Kostenfreies Erstgespräch"}
        </p>

        <div className="mt-5 space-y-3 rounded-2xl bg-muted p-4 text-[15px]">
          <p className="flex items-start gap-2.5">
            <Clock className="mt-0.5 size-4 flex-none text-primary" />
            <span>
              <strong className="font-semibold">{tag}</strong>
              <br />
              {formatUhrzeit(start)} Uhr
              {termin.ende_at && <> – {formatUhrzeit(new Date(termin.ende_at))} Uhr</>}
            </span>
          </p>
          <p className="flex items-start gap-2.5">
            <MapPin className="mt-0.5 size-4 flex-none text-primary" />
            <span>{termin.art === "erstgespraech" ? "Telefonat – ein Handwerksberater aus unserem Team ruft Sie an" : "Videocall"}</span>
          </p>
        </div>

        {termin.join_url && (
          <a href={`/j/${termin.token}`} className={`${KNOPF_PRIMAER} mt-4`}>
            <Video className="size-4" /> Zum Gespräch
          </a>
        )}

        {termin.bestaetigt_am && (
          <p className="mt-4 flex items-center justify-center gap-2 rounded-full bg-success/10 py-3 text-[15px] font-medium text-success">
            <CheckCircle2 className="size-4" /> Vielen Dank, Ihr Termin ist bestätigt
          </p>
        )}
      </div>

      {video && (
        <div className="fern-card p-6">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <PlayCircle className="size-4 text-primary" /> So läuft das Gespräch ab
          </p>
          {istDirektesVideo(video) ? (
            <video src={video} controls playsInline preload="metadata" className="mt-3 w-full rounded-2xl bg-black" />
          ) : videoEinbettung(video) ? (
            <div className="mt-3 aspect-video w-full overflow-hidden rounded-2xl bg-black">
              <iframe
                src={videoEinbettung(video)!}
                title="So läuft das Gespräch ab"
                className="size-full"
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                allowFullScreen
                loading="lazy"
              />
            </div>
          ) : (
            <a href={video} target="_blank" rel="noopener noreferrer" className={`${KNOPF_SEKUNDAER} mt-3`}>
              Video ansehen
            </a>
          )}
        </div>
      )}

      <div className="fern-card p-6">
        <p className="flex items-center gap-2 text-[15px] font-semibold">
          <CalendarPlus className="size-4 text-primary" /> In Ihren Kalender eintragen
        </p>
        <div className="mt-3 space-y-2.5">
          <a href={googleLink(kalender)} target="_blank" rel="noopener noreferrer" className={KNOPF_SEKUNDAER}>
            Google Kalender
          </a>
          <a href={`/t/${termin.token}/ics`} className={KNOPF_SEKUNDAER}>
            iPhone / Mac (Apple Kalender)
          </a>
          <a href={outlookLink(kalender)} target="_blank" rel="noopener noreferrer" className={KNOPF_SEKUNDAER}>
            Outlook.com / Hotmail
          </a>
          <a href={office365Link(kalender)} target="_blank" rel="noopener noreferrer" className={KNOPF_SEKUNDAER}>
            Outlook geschäftlich (Microsoft 365)
          </a>
          <a href={yahooLink(kalender)} target="_blank" rel="noopener noreferrer" className={KNOPF_SEKUNDAER}>
            Yahoo Kalender
          </a>
          <a href={`/t/${termin.token}/ics`} className={KNOPF_SEKUNDAER}>
            Anderer Kalender (.ics-Datei)
          </a>
        </div>
        <p className="mt-2 text-center text-[13px] text-muted-foreground">
          Die .ics-Datei funktioniert mit jedem Kalender, z. B. Outlook am PC, Samsung, GMX, Web.de oder Thunderbird.
        </p>
        <p className="mt-3 text-center text-[13px] text-muted-foreground">
          Mit Erinnerung {termin.art === "strategie" ? "eine Stunde" : "15 Minuten"} vorher.
        </p>
      </div>
    </div>
  );
}
