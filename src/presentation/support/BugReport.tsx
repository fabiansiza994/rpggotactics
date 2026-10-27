import { useEffect, useRef, useState } from 'react';
import {
  BUG_CATEGORIES,
  BUG_CATEGORY_LABEL,
  BUG_LIMITS,
  BUG_REJECTION_LABEL,
  cleanReportText,
  containsHtml,
  type BugCategory,
} from '../../game/support/bugReport';
import { cloudEnabled } from '../cloud/config';
import { loadSession } from '../cloud/session';
import { useBattleStore } from '../store/battleStore';
import { supportApi } from './api';
import { collectReportContext, onBugReportRequest, type BugReportPreset, type ReportRoute } from './reportContext';
import { createReportSubmitter } from './submit';
import '../../styles/bug-report.css';

export const GUEST_REPORT_TEXT = 'Inicia sesión para reportar un problema.';

/** The category a screen suggests (the player can change it). */
const SUGGESTED: Record<ReportRoute, BugCategory> = {
  MENU: 'OTHER',
  BATTLE: 'BATTLE',
  DECK: 'CARDS',
  CHAMPIONS: 'PROGRESS',
  STORE: 'STORE',
  PVP: 'PVP',
  SOCIAL: 'OTHER',
};

/**
 * Global "Reportar un problema" entry point: a small corner button on every screen + the report
 * modal. Accounts only (the server rejects guests too); hidden in local-only builds.
 */
export function BugReportButton({ route }: { route: ReportRoute }) {
  const account = useBattleStore((s) => s.account);
  // null = closed; {} = opened from this button; a preset = opened from elsewhere (purchase, …).
  const [open, setOpen] = useState<BugReportPreset | null>(null);
  useEffect(() => onBugReportRequest(setOpen), []);
  if (!cloudEnabled() || account.status === 'DISABLED') return null;
  const signedIn =
    account.status === 'READY' || account.status === 'NEEDS_IMPORT' || account.status === 'OFFLINE';
  return (
    <>
      <button
        type="button"
        className="bug-report-fab"
        data-route={route}
        data-authenticated={signedIn}
        aria-label="Reportar un problema"
        title={signedIn ? 'Reportar un problema' : GUEST_REPORT_TEXT}
        onClick={() => setOpen({})}
      >
        <span aria-hidden="true">!</span>
        <span className="bug-report-button-text">Reportar un problema</span>
      </button>
      {open && <BugReportModal route={route} preset={open} signedIn={signedIn} onClose={() => setOpen(null)} />}
    </>
  );
}

function BugReportModal({
  route,
  preset,
  signedIn,
  onClose,
}: {
  route: ReportRoute;
  preset: BugReportPreset;
  signedIn: boolean;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitter = useRef(
    createReportSubmitter((body) => supportApi.sendBugReport(loadSession()?.token ?? '', body)),
  );
  // Context is captured when the modal opens: that is the moment the player saw the problem.
  const [context] = useState(() => ({ ...collectReportContext(route), ...(preset.orderId ? { orderId: preset.orderId } : {}) }));
  const [category, setCategory] = useState<BugCategory>(preset.category ?? SUGGESTED[route]);
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal?.();
    return () => el?.close?.();
  }, []);

  const descriptionLength = cleanReportText(description).length;
  const tooShort = descriptionLength < BUG_LIMITS.descriptionMin;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending || tooShort) return;
    if (containsHtml(description) || containsHtml(steps))
      return setError(BUG_REJECTION_LABEL.HTML_NOT_ALLOWED);
    const token = loadSession()?.token;
    if (!token) return setError(GUEST_REPORT_TEXT);
    setSending(true);
    setError('');
    const result = await submitter.current.submit({
      category,
      description,
      reproductionSteps: steps || null,
      context,
    });
    if (result.status === 'BUSY') return;
    setSending(false);
    if (result.status === 'SENT') return setSent(result.reportId);
    setError(result.message);
    if (result.auth && loadSession()?.token === token) useBattleStore.getState().sessionExpired();
  }

  return (
    <dialog
      ref={dialog}
      className="bug-report"
      aria-labelledby="bug-report-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!sending) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div className="bug-report-body">
        <header className="bug-report-head">
          <h2 id="bug-report-title">Reportar un problema</h2>
          <button
            type="button"
            className="bug-report-close"
            aria-label="Cerrar"
            disabled={sending}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {!signedIn ? (
          <p className="bug-report-note">{GUEST_REPORT_TEXT}</p>
        ) : sent ? (
          <div className="bug-report-done" role="status">
            <p>Gracias. Tu reporte fue enviado.</p>
            <p className="bug-report-id">
              ID del reporte: <code>{sent}</code>
            </p>
            <button type="button" className="bug-report-submit" onClick={onClose} autoFocus>
              Cerrar
            </button>
          </div>
        ) : (
          <form className="bug-report-form" onSubmit={submit} noValidate>
            <label>
              <span>Categoría</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as BugCategory)}
                disabled={sending}
              >
                {BUG_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {BUG_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>
                Descripción{' '}
                <small>
                  ({descriptionLength}/{BUG_LIMITS.descriptionMax})
                </small>
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={BUG_LIMITS.descriptionMax}
                rows={4}
                required
                autoFocus
                disabled={sending}
                placeholder="¿Qué pasó? ¿Qué esperabas que pasara?"
              />
            </label>
            <label>
              <span>
                Pasos para reproducir{' '}
                <small>
                  (opcional · {cleanReportText(steps).length}/{BUG_LIMITS.stepsMax})
                </small>
              </span>
              <textarea
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
                maxLength={BUG_LIMITS.stepsMax}
                rows={3}
                disabled={sending}
                placeholder={'1. …\n2. …'}
              />
            </label>
            <p className="bug-report-hint">
              Se adjunta automáticamente la pantalla, el campeón y la versión del juego.
            </p>
            {error && (
              <p className="bug-report-error" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="bug-report-submit"
              disabled={sending || tooShort}
              aria-busy={sending}
            >
              {sending ? 'ENVIANDO...' : 'ENVIAR REPORTE'}
            </button>
          </form>
        )}
      </div>
    </dialog>
  );
}
