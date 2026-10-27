import { useRef, useState, type FormEvent } from 'react';
import { TurnstileWidget } from '../react/components/Account';
import { CLOUD_CONFIG } from '../cloud/config';
import { PUBLIC_SUPPORT_CONSENT } from '../../game/support/publicSupport';
export function PublicSupport() {
  const [token, setToken] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const submission = useRef<string | null>(null);
  const [reportId, setReportId] = useState('');
  const [error, setError] = useState('');
  const enabled = import.meta.env.VITE_PUBLIC_SUPPORT_ENABLED === '1' && !!CLOUD_CONFIG.apiUrl;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!enabled || !token || lock.current) return;
    const form = new FormData(event.currentTarget);
    submission.current ??= crypto.randomUUID();
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`${CLOUD_CONFIG.apiUrl.replace(/\/$/, '')}/api/tactics/support/public`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ submissionId: submission.current, email: form.get('email'), category: form.get('category'), reason: form.get('reason'), description: form.get('description'), reference: form.get('reference'), website: form.get('website'), consent: form.get('consent') === 'on', consentVersion: PUBLIC_SUPPORT_CONSENT, turnstileToken: token }),
      });
      if (!response.ok) { if(response.status === 409){setError('Este intento ya se registró con otros datos. Conserva la referencia o abre una nueva solicitud.');return;} if(response.status === 400)submission.current=null; setError(response.status === 429 ? 'Enviaste varias solicitudes. Intenta más tarde.' : 'No pudimos recibir la solicitud. Revisa los campos e intenta nuevamente.'); return; }
      const data = await response.json() as { reportId?: string };
      if (!data.reportId || !/^bug_[a-f0-9-]{36}$/.test(data.reportId)) throw Error('invalid response');
      setReportId(data.reportId);
    } catch { setError('No pudimos confirmar el envío. Intenta nuevamente; si recibiste un identificador, consérvalo.'); }
    finally { setBusy(false); lock.current = false; setToken(null); setAttempt(n => n + 1); }
  }
  if (reportId) return <section className="official-support" role="status"><h2>Recibimos tu solicitud.</h2><p>Referencia de seguimiento: <code>{reportId}</code></p><p>Conserva este número. Primera respuesta en un máximo de dos días hábiles; no equivale a resolución. La respuesta se enviará al correo indicado, después de las verificaciones necesarias.</p><p>Esta referencia no permite consultar datos privados ni acceder a una cuenta.</p></section>;
  return <section className="official-support" id="public-support">
    <h2>Atención al comprador y privacidad</h2>
    <p>No necesitas iniciar sesión. Primera respuesta en un máximo de dos días hábiles, sin sustituir los plazos legales. No envíes contraseñas, códigos de recuperación, documentos sensibles ni tarjetas completas.</p>
    {!enabled && <p role="status" className="official-draft">Formulario preparado para revisión, pendiente de habilitación operativa. No se enviarán datos desde esta pantalla hasta habilitarlo.</p>}
    <form onSubmit={e => void submit(e)} className="official-support-form">
      <fieldset disabled={busy || !enabled}>
        <label>Correo de contacto<input type="email" name="email" required maxLength={254} autoComplete="email" /></label>
        <label>Categoría<select name="category"><option value="STORE">Tienda</option><option value="PAYMENT">Pagos</option><option value="REFUND">Reembolsos</option><option value="PRIVACY">Privacidad y datos personales</option></select></label>
        <label>Motivo<input name="reason" required minLength={3} maxLength={120} /></label>
        <label>Descripción<textarea name="description" required minLength={10} maxLength={2000} rows={5} /></label>
        <label>Referencia de transacción (opcional)<input name="reference" maxLength={120} autoComplete="off" /></label>
        <label className="support-honeypot" aria-hidden="true">Sitio web<input name="website" defaultValue="" tabIndex={-1} autoComplete="off" /></label>
        <label className="support-consent"><input name="consent" type="checkbox" required />Autorizo a Fabian Mauricio Siza Paladines a tratar mi correo y los datos de esta solicitud para atenderla, responder y prevenir abuso, según la <a href="/privacy">política de datos en revisión</a>. No autoriza publicidad. Puedo solicitar acceso, rectificación o supresión cuando proceda por este canal.</label>
        {enabled && <TurnstileWidget key={attempt} onToken={setToken} action="public-support" siteKey={import.meta.env.VITE_PUBLIC_SUPPORT_TURNSTILE_SITE_KEY || CLOUD_CONFIG.turnstileSiteKey} />}
        {error && <p role="alert">{error}</p>}
        <button className="official-cta" disabled={!token || busy} type="submit">{busy ? 'Enviando…' : 'Enviar solicitud'}</button>
      </fieldset>
    </form>
    <p>Sin adjuntos. No hay consulta pública de solicitudes. Verificaremos tu identidad antes de compartir datos de una cuenta o transacción.</p>
  </section>;
}
