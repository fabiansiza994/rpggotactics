import { DialoguePortrait } from './DialoguePortrait';
import { useEffect, useMemo, useState } from 'react';
import type { GameContent } from '../../game';
import { DIALOGUE_LIBRARY } from '../../game/data/dialogue';
import {
  campaignDialogue,
  pvpIntro,
  pvpOutro,
  type DialogueLine,
  type DialogueSequence,
  type DialogueSide,
  type EncounterTierLike,
} from '../../game/dialogue/dialogue';
import { DialogueOverlay, type DialogueMode } from './DialogueOverlay';
import {
  campaignSeen,
  introDecision,
  outroDecision,
  pvpSeen,
  readDialogueSettings,
  type BattleProgress,
  type SeenDialogues,
} from './dialogueSession';
import { speakerView } from './speakers';

/**
 * Decides once, when a sequence first appears, whether it plays; marks it seen as soon as it is
 * shown (a refresh mid-scene does not restart it). Keyed by sequence id in the callers.
 */
function DialogueGate({
  sequence,
  content,
  mode,
  play,
  seen,
  sideOf,
}: {
  sequence: DialogueSequence;
  content: GameContent;
  mode: DialogueMode;
  play: boolean;
  seen: SeenDialogues;
  sideOf?: (line: DialogueLine) => DialogueSide;
}) {
  const [open, setOpen] = useState(play);
  useEffect(() => {
    if (open) seen.mark(sequence.id);
  }, [open, seen, sequence.id]);
  return open ? <DialogueOverlay sequence={sequence} content={content} mode={mode} sideOf={sideOf} onClose={() => setOpen(false)} /> : null;
}

/** Campaign intro (pristine battle only) and victory scene for the run's champion. */
export function CampaignDialogue({
  content,
  heroId,
  encounterId,
  tier,
  phase,
  progress,
}: {
  content: GameContent;
  heroId: string;
  encounterId: string;
  tier: EncounterTierLike;
  phase: 'intro' | 'outro' | null;
  progress: BattleProgress;
}) {
  const sequence = useMemo(
    () => (phase ? campaignDialogue(DIALOGUE_LIBRARY, { encounterId, tier, heroId, phase }) : null),
    [encounterId, tier, heroId, phase],
  );
  const seen = useMemo(() => campaignSeen(), []);
  if (!sequence || !phase) return null;
  const enabled = readDialogueSettings().campaign;
  const play =
    (phase === 'intro'
      ? introDecision({ sequenceId: sequence.id, enabled, progress, seen })
      : outroDecision({ sequenceId: sequence.id, enabled, seen })) === 'PLAY';
  return <DialogueGate key={sequence.id} sequence={sequence} content={content} mode="modal" play={play} seen={seen} />;
}

export interface PvpDialogueContext {
  content: GameContent;
  /** Server match id (stable for both seats); see pvpMatchKey for older servers. */
  matchKey: string;
  heroes: readonly [string, string];
  viewerSeat: number;
}

/** Room code + players identify a match on servers that don't send `matchId` yet. */
export const pvpMatchKey = (snapshot: { matchId?: string; code: string; members: readonly { name: string; heroId: string }[] }): string =>
  snapshot.matchId ?? `${snapshot.code}:${snapshot.members.map((m) => `${m.name}/${m.heroId}`).join('|')}`;

/** PvP intro banter: ambient (never pauses the turn clock), once per match on this device. */
export function PvpBanter({ content, matchKey, heroes, viewerSeat, progress }: PvpDialogueContext & { progress: BattleProgress }) {
  const sequence = useMemo(() => pvpIntro(DIALOGUE_LIBRARY, { heroes, matchKey }), [heroes, matchKey]);
  const seen = useMemo(() => pvpSeen(), []);
  if (!sequence) return null;
  const play = introDecision({ sequenceId: sequence.id, enabled: readDialogueSettings().pvp, progress, seen }) === 'PLAY';
  return (
    <DialogueGate
      key={sequence.id}
      sequence={sequence}
      content={content}
      mode="ambient"
      play={play}
      seen={seen}
      sideOf={(line) => (line.seat === viewerSeat ? 'left' : 'right')}
    />
  );
}

/** Post-match: the winner's line (and a short loser line), shown inside the result panel. */
export function PvpVictoryLines({ content, matchKey, heroes, winnerSeat }: Omit<PvpDialogueContext, 'viewerSeat'> & { winnerSeat: number }) {
  const sequence = useMemo(() => pvpOutro(DIALOGUE_LIBRARY, { heroes, matchKey, winnerSeat }), [heroes, matchKey, winnerSeat]);
  if (!sequence || !readDialogueSettings().pvp) return null;
  return (
    <div className="dialogue-result" data-moment="pvp_outro">
      {sequence.lines.map((line) => (
        <div className="dialogue-result-line" key={line.key} data-line-key={line.key} data-expression={line.expression ?? 'neutral'} data-portrait-variant={line.portraitVariant ?? 'neutral'} data-winner={line.seat === winnerSeat}>
          {speakerView(content,line.speaker,line.portrait,line.portraitVariant).portrait && <DialoguePortrait src={speakerView(content,line.speaker,line.portrait,line.portraitVariant).portrait!} fallback={speakerView(content,line.speaker).basePortrait} />}
          <p><b>{speakerView(content, line.speaker).name}</b><span>«{line.text}»</span></p>
        </div>
      ))}
    </div>
  );
}
