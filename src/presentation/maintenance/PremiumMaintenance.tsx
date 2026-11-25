import { useEffect, useRef, useState } from 'react';
import { CLOUD_CONFIG } from '../cloud/config';
import { useBattleStore } from '../store/battleStore';
import './maintenance.css';

export type Availability = { phase: 'OPEN' | 'DRAINING' | 'MAINTENANCE'; admissionsBlocked: boolean; purchasesBlocked: boolean };
export const openAvailability: Availability = { phase: 'OPEN', admissionsBlocked: false, purchasesBlocked: false };
export function parseAvailability(raw: unknown): Availability | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!['OPEN', 'DRAINING', 'MAINTENANCE'].includes(String(r.phase))) return null;
  const phase = r.phase as Availability['phase'];
  if (r.admissionsBlocked !== (phase !== 'OPEN') || r.purchasesBlocked !== (phase === 'MAINTENANCE')) return null;
  return { phase, admissionsBlocked: r.admissionsBlocked as boolean, purchasesBlocked: r.purchasesBlocked as boolean };
}

/** No guessed end time; stale or failed polls never turn a known closure into OPEN. */
export function PremiumMaintenance() {
  const [status, setStatus] = useState<Availability | null>(CLOUD_CONFIG.apiUrl ? null : openAvailability);
  const battle = useBattleStore(s => s.screen === 'BATTLE');
  useEffect(() => {
    if (!CLOUD_CONFIG.apiUrl) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const poll = async () => {
      clearTimeout(timer); request?.abort(); const current = new AbortController(); request = current;
      const timeout = setTimeout(() => current.abort(), 5000);
      try {
        const response = await fetch(CLOUD_CONFIG.apiUrl.replace(/\/$/, '') + '/api/tactics/availability', {
          cache: 'no-store', credentials: 'omit', signal: request.signal,
        });
        const value = response.ok ? parseAvailability(await response.json()) : null;
        if (!disposed && request === current && value) setStatus(previous => previous?.phase === value.phase ? previous : value);
      } catch { /* Keep last confirmed state, never synthesize a reopening. */ }
      clearTimeout(timeout);
      if (!disposed && request === current && !document.hidden) timer = setTimeout(() => void poll(), 5000);
    };
    const visibility = () => {
      clearTimeout(timer); request?.abort();
      if (!document.hidden) void poll();
    };
    void poll(); document.addEventListener('visibilitychange', visibility);
    return () => { disposed = true; clearTimeout(timer); request?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => { if (status) window.dispatchEvent(new CustomEvent('rpggo-maintenance', { detail: status })); }, [status]);
  return <MaintenanceSurface status={status} activeBattle={battle}/>;
}

export function MaintenanceSurface({ status, activeBattle }: { status: Availability | null; activeBattle: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const blocked = status === null || status.admissionsBlocked;
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (!blocked || activeBattle) { if (el.open) el.close(); return; }
    if (!el.open) el.showModal();
    // A late onboarding/inspection dialog must not cover a confirmed closure.
    // Observe only other dialogs opening; never react to this dialog's own changes.
    let disposed = false;
    const observer = new MutationObserver(records => {
      const opened = records.some(record => record.target !== el && (
        record.type === 'attributes' && record.target instanceof HTMLDialogElement && record.target.open
        || record.type === 'childList' && Array.from(record.addedNodes).some(node => node instanceof Element
          && (node.matches('dialog[open]') || node.querySelector('dialog[open]')))
      ));
      if (opened) queueMicrotask(() => { if (!disposed) { if (el.open) el.close(); el.showModal(); } });
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    return () => { disposed = true; observer.disconnect(); };
  }, [blocked, activeBattle]);
  return <>
    <dialog ref={dialog} className="premium-maintenance" aria-labelledby="maintenance-title"
      aria-describedby="maintenance-description" onCancel={e => e.preventDefault()}>
      <div className="maintenance-seal" aria-hidden="true"><span>✧</span></div>
      <p className="maintenance-eyebrow">RPG-GO TACTICS</p>
      <h1 id="maintenance-title">{status ? 'Actualización en curso' : 'Comprobando disponibilidad'}</h1>
      <p id="maintenance-description">{status
        ? 'Estamos preparando nuevas mejoras para el mundo arcano. Los combates volverán a estar disponibles cuando finalice la actualización.'
        : 'Estamos consultando el estado del servidor. Conserva esta pestaña abierta.'}</p>
      <div className="maintenance-activity" role="status" aria-label="Esperando confirmación del servidor"><i/><i/><i/></div>
      {status?.phase === 'DRAINING' && <p className="maintenance-note">Las partidas activas pueden finalizar. No se pierde su progreso.</p>}
    </dialog>
    {activeBattle && status?.admissionsBlocked && <aside className="maintenance-battle-note" role="status">Actualización en curso · tu combate continúa.</aside>}
  </>;
}
