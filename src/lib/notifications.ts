import { Resend } from "resend";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY || "re_placeholder");
}

const FROM = "Hoffman Solutions <noreply@hoffman-solutions.de>";

export async function notifyNewLead(opts: {
  to: string[];
  leadName: string;
  anliegen: string | null;
  ort: string | null;
  companyName: string;
}) {
  if (opts.to.length === 0) return;

  const anliegenBlock = opts.anliegen
    ? `<p style="margin:0 0 8px"><strong>Anliegen:</strong> ${opts.anliegen}</p>`
    : "";
  const ortBlock = opts.ort
    ? `<p style="margin:0 0 8px"><strong>Ort:</strong> ${opts.ort}</p>`
    : "";

  await getResend().emails.send({
    from: FROM,
    to: opts.to,
    subject: `Neuer Lead: ${opts.leadName}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 16px;color:#111">Neuer Lead eingegangen</h2>
        <p style="margin:0 0 8px">Hi, es gibt einen neuen Lead f&uuml;r <strong>${opts.companyName}</strong>.</p>
        <div style="background:#f5f5f5;border-radius:8px;padding:16px;margin:16px 0">
          <p style="margin:0 0 8px"><strong>Name:</strong> ${opts.leadName}</p>
          ${ortBlock}
          ${anliegenBlock}
        </div>
        <p style="margin:0;color:#666;font-size:14px">Bitte kontaktiere den Lead so schnell wie m&ouml;glich.</p>
      </div>
    `,
  });
}

export async function notifyLeadReminder(opts: {
  to: string[];
  leadName: string;
  minutesSinceCreation: number;
  companyName: string;
}) {
  if (opts.to.length === 0) return;

  await getResend().emails.send({
    from: FROM,
    to: opts.to,
    subject: `Erinnerung: Lead ${opts.leadName} wartet seit ${opts.minutesSinceCreation} Min.`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 16px;color:#b45309">Erinnerung: Lead noch nicht kontaktiert</h2>
        <p style="margin:0 0 8px">Der Lead <strong>${opts.leadName}</strong> f&uuml;r <strong>${opts.companyName}</strong> wartet seit <strong>${opts.minutesSinceCreation} Minuten</strong> auf eine R&uuml;ckmeldung.</p>
        <p style="margin:16px 0 0;color:#666;font-size:14px">Bitte k&uuml;mmere dich zeitnah darum, damit der Lead nicht verloren geht.</p>
      </div>
    `,
  });
}

export async function notifyLeadEscalation(opts: {
  to: string[];
  leadName: string;
  minutesSinceCreation: number;
  companyName: string;
}) {
  if (opts.to.length === 0) return;

  await getResend().emails.send({
    from: FROM,
    to: opts.to,
    subject: `ESKALATION: Lead ${opts.leadName} seit ${opts.minutesSinceCreation} Min. ohne Kontakt`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 16px;color:#dc2626">Eskalation: Lead &uuml;berf&auml;llig</h2>
        <p style="margin:0 0 8px">Der Lead <strong>${opts.leadName}</strong> f&uuml;r <strong>${opts.companyName}</strong> wurde seit <strong>${opts.minutesSinceCreation} Minuten</strong> nicht kontaktiert.</p>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0">
          <p style="margin:0;color:#dc2626;font-weight:600">Dieser Lead muss sofort bearbeitet werden.</p>
        </div>
        <p style="margin:0;color:#666;font-size:14px">Diese Nachricht wurde automatisch an das Hoffman-Team weitergeleitet.</p>
      </div>
    `,
  });
}
