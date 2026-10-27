import { RankedRewardUnlock } from './RankedRewardUnlock';
import { MasteryTitleLabel } from '../mastery/MasteryViews';
import { useEffect, useState, type CSSProperties } from 'react';
import {
  RANKED_SEASON,
  RANKED_TIERS,
  formatRp,
  rankChange,
  rankFor,
} from '../../game/ranked/ranked';
import { championPortrait } from '../assets/champions';
import { PRESENTATION_CONTENT } from '../qa/shapeshifter/runtime';
import { RankLine, RankShield } from './RankShield';
import { RankedCrest } from './RankedCosmetics';
import { RankedRewardsEntry } from './RankedRewardsTrack';
import type { RankedProfile, RankedQueueState, RankedSnapshot } from './rankedApi';
import '../../styles/ranked.css';

/**
 * Functional Ranked Preseason UI (QA pass). Every number shown comes from the server (RP, deltas,
 * milestones); labels are derived with the shared config. Codex owns the final look: hooks are
 * the class names + data-tier / data-change attributes (qa/ranked-preseason/CODEX_HANDOFF.md).
 */

export type QueueKind = 'CASUAL' | 'RANKED';

export function QueueTabs({
  value,
  onChange,
  disabled,
}: {
  value: QueueKind;
  onChange: (q: QueueKind) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ranked-tabs" role="group" aria-label="Tipo de partida">
      <button
        aria-pressed={value === 'CASUAL'}
        disabled={disabled}
        onClick={() => onChange('CASUAL')}
      >
        <b>Casual</b>
        <small>Sin RP</small>
      </button>
      <button
        aria-pressed={value === 'RANKED'}
        disabled={disabled}
        onClick={() => onChange('RANKED')}
      >
        <b>Ranked · {RANKED_SEASON.name}</b>
        <small>Afecta tu clasificación</small>
      </button>
    </div>
  );
}

function useElapsed(since: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (since === null) return '';
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Lobby panel: shield, rank, RP, progress and the single queue action. */
export function RankedPanel({
  profile,
  queue,
  busy,
  error,
  blocked,
  championName,
  onSearch,
  onCancel,
}: {
  profile: Extract<RankedProfile, { enabled: true }>;
  queue: RankedQueueState;
  busy: boolean;
  error: string;
  /** Why the current champion/deck cannot queue (null = can). */
  blocked: string | null;
  championName: string;
  onSearch: () => void;
  onCancel: () => void;
}) {
  const rank = rankFor(profile.rp);
  const searching = queue.state === 'SEARCHING';
  const elapsed = useElapsed(searching ? queue.since : null);
  const next = RANKED_TIERS[rank.tierIndex + 1];
  const nextDivision = rank.nextRp === null ? null : rankFor(rank.nextRp);
  return (
    <section
      className="ranked-panel"
      data-tier={rank.tierId}
      data-queue={queue.state}
      aria-label="Clasificatoria"
    >
      <div className="ranked-emblem">
        <span className="ranked-orbit" aria-hidden="true">
          ◇
        </span>
        <RankShield rp={profile.rp} size="lg" />
      </div>
      <div className="ranked-panel-rank">
        <span className="lobby-eyebrow">Ranked · {RANKED_SEASON.name}</span>
        <h2>{rank.label.toUpperCase()}</h2>
        <p className="ranked-rp">{formatRp(profile.rp)}</p>
        <div
          className="ranked-progress"
          role="progressbar"
          aria-label="Progreso de división"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={rank.progress}
        >
          <i style={{ width: `${rank.progress}%` }} />
        </div>
        <small>
          {rank.nextRp === null
            ? 'Rango máximo de pretemporada'
            : `${rank.nextRp - rank.rp} RP para ${nextDivision?.label}`}
          {' · '}
          {profile.wins} V – {profile.losses} D
          <span className="ranked-next-milestone">
            {next && next.milestoneCrystals > 0 && !profile.milestones.includes(next.id)
              ? ` · Primer ascenso a ${next.name}: ${next.milestoneCrystals} Cristales`
              : ''}
          </span>
        </small>
        <RankedRewardsEntry />
      </div>
      <div className="ranked-panel-action">
        {searching ? (
          <>
            <div role="status" className="ranked-searching">
              <span className="ranked-queue-rune" aria-hidden="true">
                ✧
              </span>
              <strong>Buscando rival…</strong>
              <b aria-label="Tiempo de búsqueda">{elapsed}</b>
            </div>
            <button disabled={busy} onClick={onCancel}>
              Cancelar búsqueda
            </button>
          </>
        ) : queue.state === 'MATCHED' ? (
          <p role="status" className="ranked-match-found">
            ✧ Rival encontrado
          </p>
        ) : (
          <>
            <button className="lobby-primary" disabled={busy || !!blocked} onClick={onSearch}>
              Buscar partida
            </button>
            <small>{blocked ?? `${championName} · mazo activo · Duelo 1 vs 1`}</small>
          </>
        )}
        {error && (
          <p className="lobby-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <p className="ranked-notice">{RANKED_SEASON.notice}</p>
    </section>
  );
}

/** A quick reveal inside the existing lobby; never delays ready, banter or server events. */
export function RankedIntro({
  ranked,
  seat,
  names,
  champions,
  titles,
  crests,
}: {
  ranked: RankedSnapshot;
  seat: number;
  names: [string, string];
  champions?: [string | undefined, string | undefined];
  titles?: [string | null | undefined, string | null | undefined];
  /** Equipped Ranked crests (Reward Track cosmetic) beside each name. */
  crests?: [string | null | undefined, string | null | undefined];
}) {
  const side = (s: number) => {
    const hero = champions?.[s as 0 | 1];
    return (
      <div className={`ranked-intro-side ${s === seat ? 'is-local' : 'is-rival'}`}>
        {hero && (
          <img
            className="ranked-intro-portrait"
            src={championPortrait(hero)}
            alt={PRESENTATION_CONTENT.heroes[hero]?.name ?? 'Campeón'}
          />
        )}
        <div>
          <b className="ranked-name-line">
            <RankedCrest crestId={crests?.[s as 0 | 1]} />
            {names[s]}
          </b>
          <MasteryTitleLabel titleId={titles?.[s as 0|1]}/>
          {hero && (
            <small className="ranked-intro-champion">
              {PRESENTATION_CONTENT.heroes[hero]?.name ?? 'Campeón'}
            </small>
          )}
          <RankLine rp={ranked.rp[s as 0 | 1]} />
        </div>
      </div>
    );
  };
  return (
    <section className="ranked-intro" aria-label="Partida clasificatoria">
      <span className="lobby-eyebrow">
        Rival encontrado · Partida clasificatoria · {RANKED_SEASON.name}
      </span>
      <div className="ranked-intro-match">
        {side(seat)}
        <span className="ranked-intro-vs">VS</span>
        {side(1 - seat)}
      </div>
      <small>
        El campeón queda fijado. Sin revancha. Abandonar un combate en curso penaliza RP.
      </small>
    </section>
  );
}

const CHANGE_LABEL = {
  TIER_UP: 'Nuevo rango',
  DIVISION_UP: 'Ascenso',
  DIVISION_DOWN: 'Rango actualizado',
  TIER_DOWN: 'Rango actualizado',
  SAME: '',
} as const;
const OUTCOME_LABEL = {
  WIN: 'Victoria',
  LOSS: 'Derrota',
  ABANDON: 'Abandono',
  DRAW: 'Empate',
} as const;

/** Only presentation: authoritative deltas/milestones are never inferred from an outcome. */
export function RankedResult({ ranked }: { ranked: RankedSnapshot }) {
  const o = ranked.outcome;
  if (!o)
    return (
      <p className="ranked-result is-pending" role="status">
        Aplicando resultado clasificatorio…
      </p>
    );
  const change = rankChange(o.rpBefore, o.rpAfter);
  const before = rankFor(o.rpBefore),
    after = rankFor(o.rpAfter);
  const sign = o.rpDelta > 0 ? '+' : o.rpDelta < 0 ? '−' : '±';
  const progress = {
    '--rp-from': `${before.progress}%`,
    '--rp-to': `${after.progress}%`,
  } as CSSProperties;
  return (
    <section
      className="ranked-result"
      data-outcome={o.outcome}
      data-change={change}
      data-tier={after.tierId}
      aria-label="Resultado clasificatorio"
    >
      <header className="ranked-result-heading">
        <span className="lobby-eyebrow">Ranked · {RANKED_SEASON.name}</span>
        <div>
          <b>{OUTCOME_LABEL[o.outcome]}</b>
          <strong className="ranked-delta">
            {sign}
            {Math.abs(o.rpDelta)} RP
          </strong>
        </div>
      </header>
      <div className="ranked-result-evolution">
        <div className="ranked-result-before">
          <RankShield rp={o.rpBefore} size="sm" />
          <b>{before.label}</b>
          <small>{formatRp(o.rpBefore)}</small>
        </div>
        <span className="ranked-result-arrow" aria-hidden="true">
          →
        </span>
        <div className="ranked-result-rank">
          <RankShield rp={o.rpAfter} size="lg" />
          <span>
            <b>{after.label.toUpperCase()}</b>
            <small>{formatRp(o.rpAfter)}</small>
          </span>
        </div>
      </div>
      <div className="ranked-result-track">
        <div
          className="ranked-progress"
          role="progressbar"
          aria-label="RP tras la partida"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={after.progress}
          aria-valuetext={formatRp(o.rpAfter)}
        >
          <i style={progress} />
        </div>
      </div>
      {change !== 'SAME' && (
        <p className="ranked-change">
          <b>{CHANGE_LABEL[change].toUpperCase()}</b>
          <span>
            {before.label} → {after.label}
          </span>
        </p>
      )}
      {o.capped && (
        <p className="ranked-capped">
          <strong>PARTIDA SIN CAMBIO DE RP</strong>
          <span>Mismo rival demasiadas veces hoy.</span>
        </p>
      )}
      {o.milestones.map((m) => (
        <p className="ranked-milestone" key={m.tierId}>
          <span>Recompensa de rango · {RANKED_TIERS.find((t) => t.id === m.tierId)?.name}</span>
          <strong>+{m.crystals} 💎</strong>
        </p>
      ))}
      <RankedRewardUnlock key={(o.rewards??[]).map(r=>r.rewardId).join(':')} rewards={o.rewards}/>
    </section>
  );
}
export function RankedHistoryBadge({ rp, delta }: { rp: number; delta: number }) {
  return (
    <span className="history-queue ranked-history-badge" data-queue="RANKED">
      <RankShield rp={rp} size="sm" />
      <span>
        <b>Ranked</b>
        <small>
          {delta > 0 ? '+' : delta < 0 ? '−' : '±'}
          {Math.abs(delta)} RP
        </small>
      </span>
    </span>
  );
}
