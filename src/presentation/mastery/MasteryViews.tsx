import { useState } from 'react';
import {
  MASTERY_REWARDS,
  masteryFor,
  masteryNumeral,
  titleName,
  titlesFor,
  type MasteryCosmeticHook,
} from '../../game/mastery/mastery';
import { equipTitle, useMastery, type MasteryState } from './masteryApi';
import '../../styles/mastery.css';

export const MASTERY_EMBLEMS = ['initiate', 'adept', 'expert', 'master', 'sovereign'] as const;
export const masteryBand = (level: number) =>
  level >= 10 ? 4 : level >= 8 ? 3 : level >= 5 ? 2 : level >= 3 ? 1 : 0;
export function MasteryBadge({ level, size = 'md' }: { level: number; size?: 'sm' | 'md' }) {
  const band = MASTERY_EMBLEMS[masteryBand(level)];
  return (
    <span
      className="mastery-badge"
      data-level={level}
      data-band={band}
      data-size={size}
      role="img"
      aria-label={`Maestría ${level}`}
    >
      <img src={`/art/mastery/${band}.svg`} width="128" height="136" alt="" draggable={false} />
      <b>{masteryNumeral(level)}</b>
    </span>
  );
}
export function MasteryTitleLabel({ titleId }: { titleId: string | null | undefined }) {
  const name = titleName(titleId);
  return name ? (
    <span className="mastery-title-label" data-title={titleId} title={name}>
      <i aria-hidden="true">✦</i>
      <span>{name}</span>
    </span>
  ) : null;
}
export function OwnMasteryTitle() {
  const { state } = useMastery();
  return state?.enabled ? <MasteryTitleLabel titleId={state.equippedTitleId} /> : null;
}
const HOOK_LABEL: Record<MasteryCosmeticHook, string> = {
  PORTRAIT_BORDER: 'Borde de retrato',
  MASTERY_BADGE: 'Insignia de maestría',
  PREMIUM_HOOK: 'Cosmético premium',
  MASTERY_EMBLEM: 'Emblema de maestría',
};
export type EnabledMastery = Extract<MasteryState, { enabled: true }>;
/** Pure presentation shared with the private visual lab; mutation remains the existing API. */
export function MasteryPanelContent({
  heroId,
  state,
  onEquip,
}: {
  heroId: string;
  state: EnabledMastery;
  onEquip: (id: string | null) => Promise<string | null>;
}) {
  const [showRewards, setShowRewards] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const xp = state.champions[heroId]?.xp ?? 0,
    m = masteryFor(xp),
    titles = titlesFor(heroId);
  const reached = new Set(state.rewards.filter((r) => r.heroId === heroId).map((r) => r.level));
  if (!titles.length) return null;
  async function equip(id: string | null) {
    setBusy(true);
    try {
      setMessage((await onEquip(id)) ?? '');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="mastery-panel"
      data-champion={heroId}
      data-level={m.level}
      aria-labelledby={`mastery-title-${heroId}`}
    >
      <div className="mastery-head">
        <MasteryBadge level={m.level} />
        <div>
          <span className="mastery-eyebrow">Legado del campeón</span>
          <h3 id={`mastery-title-${heroId}`}>
            Maestría <strong>{m.level}</strong>
          </h3>
          {m.nextXp === null ? (
            <div className="mastery-max">
              ✦ Maestría máxima <small>{xp.toLocaleString('es')} XP</small>
            </div>
          ) : (
            <>
              <div
                className="mastery-bar"
                role="progressbar"
                aria-label="Progreso de maestría"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={m.progress}
                aria-valuetext={`${xp} / ${m.nextXp} XP`}
              >
                <i style={{ width: `${m.progress}%` }} />
              </div>
              <div className="mastery-xp-meta">
                <b>
                  {xp.toLocaleString('es')} <span>/ {m.nextXp.toLocaleString('es')} XP</span>
                </b>
                <small>Próximo · M{m.level + 1}</small>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="mastery-equipped">
        <span className="mastery-eyebrow">Título equipado</span>
        {titleName(state.equippedTitleId) ? (
          <MasteryTitleLabel key={state.equippedTitleId} titleId={state.equippedTitleId} />
        ) : (
          <em>Aún sin título equipado</em>
        )}
      </div>
      <ul className="mastery-titles" aria-label="Títulos de maestría">
        {titles.map((t) => {
          const unlocked = m.level >= t.requiredMastery,
            equipped = state.equippedTitleId === t.id;
          return (
            <li key={t.id} data-unlocked={unlocked} data-equipped={equipped}>
              <MasteryBadge level={t.requiredMastery} size="sm" />
              <div className="mastery-title-copy">
                <b>{titleName(t.id)}</b>
                <small>
                  {equipped
                    ? '✓ EQUIPADO'
                    : unlocked
                      ? 'DESBLOQUEADO'
                      : `Maestría ${t.requiredMastery} requerida`}
                </small>
              </div>
              {equipped ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Quitar título ${titleName(t.id)}`}
                  onClick={() => void equip(null)}
                >
                  Quitar
                </button>
              ) : unlocked ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Equipar ${titleName(t.id)}`}
                  onClick={() => void equip(t.id)}
                >
                  Equipar
                </button>
              ) : (
                <span className="mastery-lock" aria-label="Bloqueado">
                  ◇
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {message && (
        <p role="alert" className="mastery-error">
          {message}
        </p>
      )}
      <button
        type="button"
        className="mastery-rewards-toggle"
        aria-expanded={showRewards}
        onClick={() => setShowRewards((v) => !v)}
      >
        {showRewards ? 'Ocultar recompensas' : 'Ver recompensas'}{' '}
        <span aria-hidden="true">{showRewards ? '−' : '+'}</span>
      </button>
      {showRewards && (
        <ul className="mastery-rewards">
          {MASTERY_REWARDS.map((r) => (
            <li key={r.level} data-reached={reached.has(r.level) || m.level >= r.level}>
              <b>M{r.level}</b>
              <span>
                Título{r.cosmetic && <small>{HOOK_LABEL[r.cosmetic]} · próximamente</small>}
              </span>
              {r.crystals > 0 && <strong>✧ {r.crystals}</strong>}
            </li>
          ))}
        </ul>
      )}
      <small className="mastery-note">Maestría disponible desde esta versión.</small>
    </section>
  );
}
export function MasteryPanel({ heroId }: { heroId: string }) {
  const { state } = useMastery();
  return state?.enabled ? (
    <MasteryPanelContent heroId={heroId} state={state} onEquip={equipTitle} />
  ) : null;
}
