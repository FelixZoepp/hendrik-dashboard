"use client";

import { useActionState, useState } from "react";
import { Check, Copy, FlaskConical, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AUSWAHL_KLASSE } from "@/components/zugaenge/stil";
import type { QuellenArt } from "@/lib/eingang/logik";
import {
  googleKeyNeu,
  quelleAktivSetzen,
  quelleAnlegen,
  quelleEinstellungen,
  testleadSenden,
  tokenNeu,
  type AktionStatus,
} from "./aktionen";
import { ANLEITUNG, ART_LABEL } from "./anleitung";

const START: AktionStatus = { fehler: null, meldung: null };

export interface QuelleAnsicht {
  id: string;
  art: QuellenArt;
  name: string;
  aktiv: boolean;
  url: string;
  googleKey: string | null;
  meta: {
    url: string;
    verifyToken: boolean;
    appSecret: boolean;
    pageId: string;
    formIds: string;
    tokenEnv: string;
    tokenEnvName: string;
    tokenVorhanden: boolean;
    standardEnv: string;
  } | null;
  mapping: string;
  letzterEingang: string;
}

function Kopierfeld({ label, wert }: { label: string; wert: string }) {
  const [kopiert, setKopiert] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={wert} className="bg-background font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(wert);
            setKopiert(true);
            setTimeout(() => setKopiert(false), 2000);
          }}
        >
          {kopiert ? <Check /> : <Copy />}
          {kopiert ? "Kopiert" : "Kopieren"}
        </Button>
      </div>
    </div>
  );
}

function Meldung({ status }: { status: AktionStatus }) {
  if (status.fehler) return <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{status.fehler}</p>;
  if (status.meldung) return <p className="rounded-xl bg-accent px-3 py-2 text-sm text-accent-foreground">{status.meldung}</p>;
  return null;
}

function Ampel({ an, text }: { an: boolean; text: string }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <span className={`size-2 rounded-full ${an ? "bg-emerald-500" : "bg-red-500"}`} />
      {text}
    </li>
  );
}

function MetaFelder({ meta, praefix }: { meta: NonNullable<QuelleAnsicht["meta"]> | null; praefix: string }) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${praefix}-page_id`}>Seiten-ID (Facebook-Seite)</Label>
        <Input id={`${praefix}-page_id`} name="page_id" inputMode="numeric" defaultValue={meta?.pageId} placeholder="z. B. 102345678901234" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${praefix}-form_ids`}>Formular-IDs (optional, mit Komma)</Label>
        <Input id={`${praefix}-form_ids`} name="form_ids" defaultValue={meta?.formIds} placeholder="leer = alle Formulare dieser Seite" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${praefix}-token_env`}>Eigener Seiten-Token (optional, Name der Env-Variable)</Label>
        <Input id={`${praefix}-token_env`} name="token_env" defaultValue={meta?.tokenEnv} placeholder="leer = META_LEADS_ACCESS_TOKEN" className="font-mono text-xs" />
      </div>
    </>
  );
}

export function QuelleKarte({ quelle }: { quelle: QuelleAnsicht }) {
  const [einstStatus, einstAktion, einstLaeuft] = useActionState(quelleEinstellungen, START);
  const [testStatus, testAktion, testLaeuft] = useActionState(testleadSenden, START);

  return (
    <div className={`space-y-4 rounded-2xl border p-4 ${quelle.aktiv ? "border-border" : "border-dashed border-border opacity-80"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{quelle.name}</p>
          <p className="text-xs text-muted-foreground">
            {ART_LABEL[quelle.art]} · letzter Eingang {quelle.letzterEingang}
          </p>
        </div>
        <form action={quelleAktivSetzen}>
          <input type="hidden" name="id" value={quelle.id} />
          <input type="hidden" name="aktiv" value={quelle.aktiv ? "0" : "1"} />
          <Button type="submit" size="sm" variant={quelle.aktiv ? "secondary" : "default"}>
            {quelle.aktiv ? "Aktiv – ausschalten" : "Aus – einschalten"}
          </Button>
        </form>
      </div>

      {quelle.art === "meta" && quelle.meta ? (
        <>
          <Kopierfeld label="Callback-URL (für alle Kunden gleich)" wert={quelle.meta.url} />
          <ul className="space-y-1">
            <Ampel an={quelle.meta.verifyToken} text="META_LEADS_VERIFY_TOKEN (Bestätigungs-Token) gesetzt" />
            <Ampel an={quelle.meta.appSecret} text="App-Secret (META_LEADS_APP_SECRET bzw. META_APP_SECRET) gesetzt" />
            <Ampel an={quelle.meta.tokenVorhanden} text={`Seiten-Token ${quelle.meta.tokenEnvName} gesetzt`} />
          </ul>
        </>
      ) : (
        <Kopierfeld label="Webhook-URL" wert={quelle.url} />
      )}

      {quelle.googleKey && (
        <div className="space-y-2">
          <Kopierfeld label="Schlüssel (Key) für Google Ads" wert={quelle.googleKey} />
          <form action={googleKeyNeu}>
            <input type="hidden" name="id" value={quelle.id} />
            <Button type="submit" size="xs" variant="ghost">
              <RefreshCw />
              Neuen Schlüssel erzeugen
            </Button>
          </form>
        </div>
      )}

      <details className="rounded-xl bg-muted/60 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">So richtest du es ein</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
          {ANLEITUNG[quelle.art].map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </details>

      <details className="rounded-xl bg-muted/60 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">Einstellungen</summary>
        <form action={einstAktion} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={quelle.id} />
          <Meldung status={einstStatus} />
          <div className="space-y-1.5">
            <Label htmlFor={`name-${quelle.id}`}>Name</Label>
            <Input id={`name-${quelle.id}`} name="name" defaultValue={quelle.name} />
          </div>
          {quelle.art === "meta" && <MetaFelder meta={quelle.meta} praefix={quelle.id} />}
          {quelle.art === "webhook" && (
            <div className="space-y-1.5">
              <Label htmlFor={`mapping-${quelle.id}`}>Feld-Zuordnung (optional, eine pro Zeile)</Label>
              <Textarea
                id={`mapping-${quelle.id}`}
                name="mapping"
                defaultValue={quelle.mapping}
                placeholder={"telefon = kontakt.handy\nname = daten.voller_name"}
                className="font-mono text-xs"
              />
            </div>
          )}
          <Button type="submit" size="sm" disabled={einstLaeuft}>
            {einstLaeuft ? "Speichert…" : "Speichern"}
          </Button>
        </form>
        {quelle.art !== "meta" && (
          <form action={tokenNeu} className="mt-3 border-t border-border pt-3">
            <input type="hidden" name="id" value={quelle.id} />
            <p className="mb-2 text-xs text-muted-foreground">
              Neue Adresse erzeugen, falls die alte in falsche Hände geraten ist. Danach die neue URL beim Anbieter eintragen –
              die alte funktioniert sofort nicht mehr.
            </p>
            <Button type="submit" size="xs" variant="ghost">
              <RefreshCw />
              Neue URL erzeugen
            </Button>
          </form>
        )}
      </details>

      <form action={testAktion} className="space-y-2">
        <input type="hidden" name="id" value={quelle.id} />
        <Meldung status={testStatus} />
        <Button type="submit" variant="secondary" className="w-full" disabled={testLaeuft}>
          <FlaskConical />
          {testLaeuft ? "Wird gesendet…" : "Testlead senden"}
        </Button>
      </form>
    </div>
  );
}

export function NeueQuelle({ companyId }: { companyId: string }) {
  const [offen, setOffen] = useState(false);
  const [schluessel, setSchluessel] = useState(0);
  return (
    <Dialog
      open={offen}
      onOpenChange={(o) => {
        setOffen(o);
        if (!o) setSchluessel((k) => k + 1);
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <Plus />
        Eingang anlegen
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Neuer Lead-Eingang</DialogTitle>
          <DialogDescription>Woher kommen die Anfragen? Danach bekommst du die Adresse zum Eintragen.</DialogDescription>
        </DialogHeader>
        <NeueQuelleFormular key={schluessel} companyId={companyId} fertig={() => setOffen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NeueQuelleFormular({ companyId, fertig }: { companyId: string; fertig: () => void }) {
  const [art, setArt] = useState<QuellenArt>("perspective");
  const [status, aktion, laeuft] = useActionState(async (vorher: AktionStatus, fd: FormData) => {
    const r = await quelleAnlegen(vorher, fd);
    if (!r.fehler) fertig();
    return r;
  }, START);

  return (
    <form action={aktion} className="space-y-4">
      <input type="hidden" name="company_id" value={companyId} />
      <Meldung status={status} />
      <div className="space-y-1.5">
        <Label htmlFor="neu-art">Art</Label>
        <select id="neu-art" name="art" className={AUSWAHL_KLASSE} value={art} onChange={(e) => setArt(e.target.value as QuellenArt)}>
          {(Object.keys(ART_LABEL) as QuellenArt[]).map((a) => (
            <option key={a} value={a}>
              {ART_LABEL[a]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="neu-name">Name (optional)</Label>
        <Input id="neu-name" name="name" placeholder="z. B. Funnel Badsanierung" />
      </div>
      {art === "meta" && <MetaFelder meta={null} praefix="neu" />}
      <Button type="submit" className="w-full" disabled={laeuft}>
        {laeuft ? "Wird angelegt…" : "Anlegen"}
      </Button>
    </form>
  );
}
