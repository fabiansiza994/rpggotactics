import { DialoguePortrait } from './DialoguePortrait';
import { useEffect, useRef, useState } from 'react';
import type { GameContent } from '../../game';
import type { DialogueLine, DialogueSequence, DialogueSide } from '../../game/dialogue/dialogue';
import { NARRATOR, speakerView } from './speakers';
import '../../styles/dialogue.css';

/** UI chrome labels (dialogue text itself lives in game/data/dialogue). */
const LABEL = { skip: 'Saltar', next: 'Siguiente', close: 'Continuar', region: 'Diálogo' };

/**
 * `modal`: campaign. Covers the board until the player advances or skips (click/tap, Space,
 * Enter; Esc or «Saltar» closes everything) and swallows battle hotkeys meanwhile.
 * `ambient`: PvP. Never blocks the board or the turn clock: it advances by itself and only the
 * speech box takes clicks.
 */
export type DialogueMode = 'modal' | 'ambient';

export interface DialogueOverlayProps {
  sequence: DialogueSequence;
  /** Alternate finish is retained only for the local visual comparison. */
  visualVariant?: 'comic' | 'tactical';
  content: GameContent;
  mode: DialogueMode;
  /** Which side a line goes on. Default: heroes left, everyone else right. */
  sideOf?: (line: DialogueLine) => DialogueSide;
  onClose: () => void;
  /** Optional presentation audio hook; no audio assets or game timing dependency. */
  onCue?: (cue: 'open' | 'advance' | 'emphasis', line: DialogueLine) => void;
}

/** Pure navigation: `next` walks the lines and closes after the last; `skip` closes at once. */
export function dialogueStep(index: number, length: number, action: 'next' | 'skip'): { index: number; closed: boolean } {
  if (action === 'skip' || index >= length - 1) return { index, closed: true };
  return { index: index + 1, closed: false };
}

export const autoAdvanceMs = (line: DialogueLine): number =>
  line.hint?.holdMs ?? Math.min(5200, Math.max(2400, 1600 + line.text.length * 45));

export function dialogueSide(line: DialogueLine, content: GameContent, sideOf?: (line: DialogueLine) => DialogueSide): DialogueSide | 'center' {
  return line.speaker === NARRATOR && !line.side ? 'center' : line.side ?? sideOf?.(line) ?? (speakerView(content, line.speaker).isHero ? 'left' : 'right');
}

/** Seat/side, not speaker id: mirror matches retain two separate portraits. */
export function dialogueCast(sequence: DialogueSequence, content: GameContent, sideOf?: (line: DialogueLine) => DialogueSide) {
  return (['left', 'right'] as const).map(side => ({side, line: sequence.lines.find(line => dialogueSide(line, content, sideOf) === side)}));
}

export function DialogueOverlay({ sequence, content, mode, sideOf, onClose, onCue, visualVariant = 'comic' }: DialogueOverlayProps) {
  const [index, setIndex] = useState(0);
  const closed = useRef(false);
  const layer = useRef<HTMLDivElement>(null);
  const line = sequence.lines[index];
  const last = index >= sequence.lines.length - 1;

  const close = () => {
    if (closed.current) return;
    closed.current = true;
    onClose();
  };
  const advance = () => {
    const step = dialogueStep(index, sequence.lines.length, 'next');
    if (step.closed) close();
    else setIndex(step.index);
  };
  // Keyboard handlers read the latest closures through a ref (the listener is bound once).
  const actions = useRef({ advance, close });
  useEffect(() => {
    actions.current = { advance, close };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode === 'modal' && e.key === 'Tab') {
        const buttons = Array.from(layer.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        e.preventDefault(); e.stopImmediatePropagation(); return;
      }
      if (mode === 'ambient' && (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Escape') actions.current.close();
      else if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) actions.current.advance();
      else if (mode === 'ambient') return; // PvP: every other key keeps working.
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'ambient' || !line) return;
    const timer = setTimeout(() => actions.current.advance(), Math.min(2600, Math.max(1400, autoAdvanceMs(line) * .55)));
    return () => clearTimeout(timer);
  }, [mode, line]);

  useEffect(() => {
    if (mode !== 'modal') return;
    const previous = document.activeElement as HTMLElement | null;
    layer.current?.querySelector<HTMLButtonElement>('.dialogue-next')?.focus({preventScroll:true});
    return () => { if (previous?.isConnected) previous.focus({preventScroll:true}); };
  }, [mode]);
  useEffect(() => {
    if (line) { onCue?.(index === 0 ? 'open' : 'advance', line); onCue?.('emphasis', line); }
  }, [index, line, onCue]);

  useEffect(() => {
    const urls = new Set(sequence.lines.map(l => speakerView(content,l.speaker,l.portrait,l.portraitVariant).portrait).filter((url):url is string=>!!url));
    for (const src of urls) { const image = new Image(); image.decoding='async'; image.src=src; }
  }, [sequence, content]);
  if (!line) return null;
  const speaker = speakerView(content, line.speaker, line.portrait, line.portraitVariant);
  const side = dialogueSide(line, content, sideOf);
  const cast = dialogueCast(sequence, content, sideOf);
  return (
    <div ref={layer} className="dialogue-layer" data-mode={mode} data-moment={sequence.moment.toLowerCase()}
      role="dialog" aria-modal={mode === 'modal' ? true : undefined} aria-label={LABEL.region}
      onClick={mode === 'modal' ? advance : undefined}>
      <div className="dialogue-stage" data-variant={visualVariant} data-side={side} data-champion={speaker.id}>
        {cast.map(({side: position, line: original}) => {
          const actorLine = side === position ? line : original;
          if (!actorLine) return <div key={position} className="dialogue-actor is-empty" data-side={position} aria-hidden="true" />;
          const actor = speakerView(content, actorLine.speaker, actorLine.portrait, actorLine.portraitVariant);
          return <div key={position} className="dialogue-actor" data-side={position} data-active={side === position}
            data-portrait-variant={actor.portraitVariant} data-champion={actor.id} data-expression={actorLine.expression ?? 'neutral'} aria-hidden="true">
            <div className="dialogue-portrait">{actor.portrait ? <DialoguePortrait src={actor.portrait} fallback={actor.basePortrait} /> : <span>{actor.name.slice(0,1)}</span>}</div>
            <span className="dialogue-actor-name">{actor.name}</span>
          </div>;
        })}
        <section className="dialogue-box" data-side={side} data-speaker={line.speaker}
          data-champion={speaker.id} data-expression={line.expression ?? 'neutral'} data-emphasis={line.hint?.emphasis}
          data-line-key={line.key} onClick={e=>{e.stopPropagation();advance();}}>
          <span className="dialogue-pointer" aria-hidden="true" />
          <header className="dialogue-heading"><strong className="dialogue-name">{speaker.name || 'Narrador'}</strong>
            <button type="button" className="dialogue-skip" onClick={e=>{e.stopPropagation();close();}}>{LABEL.skip} <kbd>Esc</kbd></button>
          </header>
          <div className="dialogue-body" aria-live="polite" aria-atomic="true">
            <p key={line.key} className="dialogue-text">{line.text}</p>
          </div>
          <footer><span className="dialogue-progress" role="img" aria-label={`Paso ${index + 1} de ${sequence.lines.length}`}>{sequence.lines.map((step, at) => <span key={step.key} aria-hidden="true" data-reached={at <= index} data-current={at === index}>◆</span>)}</span>
            <button type="button" className="dialogue-next" onClick={e=>{e.stopPropagation();advance();}}>{last ? LABEL.close : LABEL.next} <span aria-hidden="true">▸</span></button>
          </footer>
        </section>
      </div>
    </div>
  );
}
