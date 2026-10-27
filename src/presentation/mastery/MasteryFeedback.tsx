import { masteryLegendaryName } from '../catalog/CatalogRewards';
import { PRESENTATION_CONTENT } from '../qa/shapeshifter/runtime';
import { useEffect, useRef, useState } from 'react';
import { masteryFor, titleName, titlesFor } from '../../game/mastery/mastery';
import { refreshMastery, useMastery } from './masteryApi';
import { MasteryBadge, type EnabledMastery } from './MasteryViews';
export function masteryGain(before: EnabledMastery, after: EnabledMastery, heroId: string) {
  const from = before.champions[heroId]?.xp ?? 0,
    to = after.champions[heroId]?.xp ?? 0;
  const oldLevel = masteryFor(from).level,
    newLevel = masteryFor(to).level;
  const titles = titlesFor(heroId).filter(
    (t) => t.requiredMastery > oldLevel && t.requiredMastery <= newLevel,
  );
  const oldRewards = new Set(before.rewards.filter((r) => r.heroId === heroId).map((r) => r.level));
  const crystals = after.rewards
    .filter((r) => r.heroId === heroId && !oldRewards.has(r.level))
    .reduce((n, r) => n + r.crystals, 0);
  return { from, to, xp: Math.max(0, to - from), oldLevel, newLevel, titles, crystals };
}
export function MasteryGainView({
  before,
  after,
  heroId,
  heroName,
  compact = false,
}: {
  before: EnabledMastery;
  after: EnabledMastery;
  heroId: string;
  heroName: string;
  compact?: boolean;
}) {
  const g = masteryGain(before, after, heroId);
  if (!g.xp) return null;
  return (
    <section
      className="mastery-gain"
      data-champion={heroId}
      data-compact={compact}
      data-level-up={g.newLevel > g.oldLevel}
      role="status"
      aria-label="Maestría ganada"
    >
      <MasteryBadge level={g.newLevel} />
      <div>
        <span className="mastery-eyebrow">{heroName}</span>
        <h3>
          +{g.xp} XP <small>de maestría</small>
        </h3>
        <p>
          {g.from} → {g.to} XP
        </p>
        {g.newLevel > g.oldLevel && (
          <strong className="mastery-level-up">
            Maestría {g.oldLevel} → {g.newLevel}
          </strong>
        )}
        {g.titles.map((t) => (
          <div className="mastery-title-unlock" key={t.id}>
            <small>Nuevo título desbloqueado</small>
            <b>{titleName(t.id)}</b>
          </div>
        ))}
        {masteryLegendaryName(heroId,g.oldLevel,g.newLevel,PRESENTATION_CONTENT) && <div className="mastery-title-unlock"><small>Legendaria desbloqueada</small><b>{masteryLegendaryName(heroId,g.oldLevel,g.newLevel,PRESENTATION_CONTENT)}</b></div>}
        {g.crystals > 0 && (
          <strong className="mastery-crystal-gain">+{g.crystals} ✧ Cristales</strong>
        )}
      </div>
    </section>
  );
}
/** Observe confirmed server reads only. No XP prediction, grant, polling loop or wallet mutation. */
export function useMasteryBattleFeedback({
  heroId,
  heroName,
  battleKey,
  finished,
  verified = true,
}: {
  heroId: string;
  heroName: string;
  battleKey: unknown;
  finished: boolean;
  verified?: boolean;
}) {
  const { state } = useMastery();
  const [before, setBefore] = useState<{ key: unknown; state: EnabledMastery } | null>(null);
  const requested = useRef<unknown>(null);
  if (
    !finished &&
    state?.enabled &&
    (!before || before.key !== battleKey || before.state !== state)
  )
    setBefore({ key: battleKey, state });
  useEffect(() => {
    if (finished && verified && requested.current !== battleKey) {
      requested.current = battleKey;
      void refreshMastery();
    }
  }, [finished, verified, battleKey]);
  if (!finished || !verified || !state?.enabled || !before || before.key !== battleKey) return null;
  if (!masteryGain(before.state, state, heroId).xp) return null;
  return (
    <MasteryGainView
      compact
      before={before.state}
      after={state}
      heroId={heroId}
      heroName={heroName}
    />
  );
}
