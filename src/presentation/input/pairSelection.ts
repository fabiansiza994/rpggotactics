import { samePos, type GameEngine, type Pos } from '../../game';
export interface PairSelection {
  cardUid: string;
  first: Pos;
}
export function pairTargets(
  engine: GameEngine,
  uid: string | null,
  pair: PairSelection | null,
): Pos[] {
  if (!uid || !pair || pair.cardUid !== uid)
    return uid
      ? engine.getValidTargets(uid).filter((p) => {
          const t = engine.selectionTargeting(uid);
          return t?.type !== 'UNIT' || !t.pairSwap || engine.getSecondaryTargets(uid, p).length > 0;
        })
      : [];
  const hero = engine.state.units.find((u) => u.id === engine.heroId);
  return engine
    .getSecondaryTargets(uid, pair.first)
    .flatMap((p) => (p ? [p] : hero ? [hero.pos] : []));
}
export function pairSecondary(engine: GameEngine, pos: Pos): Pos | null {
  const hero = engine.state.units.find((u) => u.id === engine.heroId);
  return hero && samePos(pos, hero.pos) ? null : pos;
}
export function planCardSelection(
  engine: GameEngine,
  uid: string,
  pos: Pos | null,
  pair: PairSelection | null,
) {
  if (pair?.cardUid === uid) {
    if (!pos || !pairTargets(engine, uid, pair).some((p) => samePos(p, pos)))
      return { kind: 'invalid' } as const;
    const secondary = pairSecondary(engine, pos);
    if (!engine.previewCard(uid, pair.first, secondary).valid) return { kind: 'invalid' } as const;
    return {
      kind: 'command',
      command: engine.selectionCommand(uid, pair.first, secondary),
    } as const;
  }
  const targeting = engine.selectionTargeting(uid);
  if (targeting?.type === 'UNIT' && targeting.pairSwap) {
    if (!pos || !engine.getSecondaryTargets(uid, pos).length) return { kind: 'invalid' } as const;
    return { kind: 'first', pair: { cardUid: uid, first: { ...pos } } } as const;
  }
  return { kind: 'command', command: engine.selectionCommand(uid, pos) } as const;
}
