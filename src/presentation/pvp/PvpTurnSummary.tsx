/** One layout owner: the Ranked badge must never share a grid cell with connection status. */
export function PvpTurnSummary({ ranked, title, round, network, seconds, validating }: {
  ranked: boolean; title: string; round: number; network: string; seconds: number | null; validating: boolean;
}) {
  return <div className="pvp-turn-summary">
    {ranked && <span className="pvp-ranked-badge">Clasificatoria · Pretemporada</span>}
    <strong className="pvp-turn-title">{title}</strong>
    <div className="pvp-turn-meta">
      <span>Ronda {round}</span>
      <span className={`connection-indicator ${network==='Conectado'?'is-connected':'is-pending'}`} role="status" aria-live="polite" aria-label={network} title={network}><svg viewBox="0 0 24 20" width="20" height="18" fill="currentColor" aria-hidden="true"><path d="M2 14h3v6H2zM7 10h3v10H7zM12 6h3v14h-3zM17 2h3v18h-3z"/></svg>{network!=='Conectado'&&<span>{network}</span>}</span>
      {seconds !== null && <span>{seconds} s</span>}
      {validating && <span className="sr-only">Validando acción</span>}
    </div>
  </div>;
}
