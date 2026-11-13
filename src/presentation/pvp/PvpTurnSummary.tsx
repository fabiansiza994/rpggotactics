/** One layout owner: the Ranked badge must never share a grid cell with connection status. */
export function PvpTurnSummary({ ranked, title, round, network, seconds, validating }: {
  ranked: boolean; title: string; round: number; network: string; seconds: number | null; validating: boolean;
}) {
  return <div className="pvp-turn-summary">
    {ranked && <span className="pvp-ranked-badge">Clasificatoria · Pretemporada</span>}
    <strong className="pvp-turn-title">{title}</strong>
    <div className="pvp-turn-meta">
      <span>Ronda {round}</span>
      <span role="status" aria-live="polite">{network}</span>
      {seconds !== null && <span>{seconds} s</span>}
      {validating && <span>Validando…</span>}
    </div>
  </div>;
}
