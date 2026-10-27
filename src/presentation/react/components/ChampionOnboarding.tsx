import { isCampaignStartingChampion } from '../../../game/collection/champion-unlocks';
import { PRESENTATION_CONTENT as DEFAULT_CONTENT } from '../../qa/shapeshifter/runtime';
import { useShallow } from 'zustand/react/shallow';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CHAMPION_MILESTONES,
  deckSize,
  needsStartingChampion,
  pendingChampionUnlock,
  type UnlockRequirement,
} from '../../../game';
import { championOf, championPortrait } from '../../assets/champions';
import { availableChampionsIn, championPromptsAllowed, useBattleStore } from '../../store/battleStore';
import { openAccountView } from './Account';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
/** "Encuentro III" for a milestone reached after 3 completed encounters. */
export const encounterLabel = (encounters: number) => `Encuentro ${ROMAN[encounters - 1] ?? encounters}`;

/** The Champions screen line for a locked champion (accurate about choices vs. automatic unlocks). */
export function requirementText(req: UnlockRequirement | null): string {
  if (!req) return 'Todavía no disponible.';
  if (req.ready) return 'Ya puedes desbloquearlo: vuelve al menú para reclamarlo.';
  return req.choice
    ? `Completa el ${encounterLabel(req.encounters)} con cualquier campeón para elegir un nuevo campeón.`
    : `Completa el ${encounterLabel(req.encounters)} con cualquier campeón para desbloquearlo.`;
}

/** Native modal dialog opened on mount; `onClose` = Escape (when allowed). */
function Dialog({ label, className, onClose, children }: { label: string; className: string; onClose?(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`pile-dialog onboarding-dialog ${className}`}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
    >
      {children}
    </dialog>
  );
}

function ChampionCard({ heroId, selected, onSelect }: { heroId: string; selected?: boolean; onSelect?(): void }) {
  const info = championOf(heroId);
  const hero = DEFAULT_CONTENT.heroes[heroId]!;
  const body = (
    <>
      <img className="onb-portrait" src={championPortrait(heroId)} alt="" draggable={false} />
      <span className="onb-card-text">
        {selected && <span className="onb-selected">✦ Seleccionado</span>}
        <strong className="onb-name">{hero.name}</strong>
        <span className="onb-role">{info?.role}</span>
        <span className="onb-identity" aria-label={`Identidad: ${info?.identity.join(', ')}`}>
          {info?.identity.map((tag) => (
            <em key={tag}>{tag}</em>
          ))}
        </span>
        <span className="onb-tagline">{info?.tagline}</span>
      </span>
    </>
  );
  return onSelect ? (
    <button type="button" className={`onb-card${selected ? ' is-selected' : ''}`} data-champion={heroId} aria-pressed={selected} onClick={onSelect}>
      {body}
    </button>
  ) : (
    <div className="onb-card" data-champion={heroId}>
      {body}
    </div>
  );
}

/** Starter deck summary (cards and copies straight from the hero definition). */
function StarterDeck({ heroId }: { heroId: string }) {
  const hero = DEFAULT_CONTENT.heroes[heroId]!;
  return (
    <section className="onb-deck" aria-label="Mazo inicial">
      <h3>Mazo inicial · {deckSize(hero.deck)} cartas</h3>
      <ul>
        {hero.deck.map((e) => (
          <li key={e.cardId}>
            <b>{e.count}×</b> {DEFAULT_CONTENT.cards[e.cardId]?.name ?? e.cardId}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * First-time champion choice (new profiles only): choose → starter deck → Encounter I.
 * Offers the progression champions; the free Shapeshifter is claimed separately in Store.
 */
function FirstChampionChoice() {
  const available = useBattleStore(useShallow(availableChampionsIn)).filter(isCampaignStartingChampion);
  const choose = useBattleStore((s) => s.chooseStartingChampion);
  const busy = useBattleStore((s) => s.cloud.busy !== null);
  // A returning player on a new device signs in instead (their account keeps its champions).
  const guest = useBattleStore((s) => s.account.status === 'GUEST');
  const [picked, setPicked] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const second = CHAMPION_MILESTONES[0]!;
  async function start() {
    if (!picked) return;
    setError(null);
    if (!(await choose(picked))) return setError('No se pudo guardar tu elección. Inténtalo de nuevo.');
    const s = useBattleStore.getState();
    const ok = s.runs[picked] ? (s.continueRun(), true) : await s.startRun();
    if (!ok) setError('No se pudo iniciar la campaña. Inténtalo de nuevo.');
  }
  return (
    <Dialog label="Elige tu campeón" className="onb-first">
      {!confirming ? (
        <>
          <span className="onb-eyebrow">Tu primera aventura</span>
          <h2>Elige tu campeón</h2>
          <p>
            Empiezas con uno. Los demás siguen visibles y se desbloquean avanzando en la campaña: al completar el{' '}
            {encounterLabel(second.encounters)} eliges el siguiente.
          </p>
          <div className="onb-cards" role="group" aria-label="Campeones disponibles">
            {available.map((id) => (
              <ChampionCard key={id} heroId={id} selected={picked === id} onSelect={() => setPicked(id)} />
            ))}
          </div>
          {picked && <button type="button" className="db-btn onb-preview" aria-expanded={preview} onClick={() => setPreview(!preview)}>Ver mazo inicial · {DEFAULT_CONTENT.heroes[picked]!.name}</button>}
          {preview && picked && <StarterDeck heroId={picked} />}
          <div className="confirm-actions">
            {guest && (
              <button type="button" className="account-link onb-signin" onClick={() => openAccountView('LOGIN')}>
                ¿Ya tienes cuenta? Inicia sesión
              </button>
            )}
            <button type="button" className="db-btn db-btn-primary" disabled={!picked} onClick={() => setConfirming(true)}>
              {picked ? `Continuar con ${DEFAULT_CONTENT.heroes[picked]!.name}` : 'Elige un campeón'}
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="onb-eyebrow">Has elegido</span>
          <h2>{DEFAULT_CONTENT.heroes[picked!]!.name}</h2>
          <div className="onb-confirm">
            <ChampionCard heroId={picked!} />
            <StarterDeck heroId={picked!} />
          </div>
          <p className="onb-note">No es una elección permanente: podrás jugar con los demás cuando los desbloquees. Cada campeón avanza por la campaña por separado.</p>
          {error && (
            <p className="account-error" role="alert">
              {error}
            </p>
          )}
          <div className="confirm-actions">
            <button type="button" className="db-btn" disabled={busy} onClick={() => setConfirming(false)}>
              Volver
            </button>
            <button type="button" className="db-btn db-btn-primary" disabled={busy} onClick={() => void start()}>
              {busy ? 'Guardando…' : 'Comenzar Encuentro I'}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** A reached milestone: pick one of the locked champions (CHOICE) or receive it (REVEAL). Never random. */
function ChampionUnlockDialog({ onLater }: { onLater(): void }) {
  const profile = useBattleStore((s) => s.profile);
  const available = useBattleStore(useShallow(availableChampionsIn));
  const claim = useBattleStore((s) => s.claimChampionUnlock);
  const busy = useBattleStore((s) => s.cloud.busy !== null);
  const pending = pendingChampionUnlock(profile, available);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!pending) return null;
  const milestone = CHAMPION_MILESTONES.find((m) => m.id === pending.milestone)!;
  const next = CHAMPION_MILESTONES.find((m) => m.encounters > milestone.encounters);
  const reveal = pending.kind === 'REVEAL';
  async function unlock() {
    setError(null);
    for (const id of reveal ? pending!.options : picked ? [picked] : [])
      if (!(await claim(id))) return setError('No se pudo desbloquear. Inténtalo de nuevo.');
  }
  return (
    <Dialog label={reveal ? 'Nuevo campeón desbloqueado' : 'Desbloquea un nuevo campeón'} className="onb-unlock" onClose={onLater}>
      <span className="onb-eyebrow">Has completado el {encounterLabel(milestone.encounters)}</span>
      <h2>{reveal ? 'Nuevo campeón desbloqueado' : 'Desbloquea un nuevo campeón'}</h2>
      <p>
        {reveal
          ? 'Se une a tu grupo. Empieza su propia campaña desde el Encuentro I.'
          : `Elige uno. Empieza su propia campaña desde el Encuentro I.${next ? ` El otro se desbloquea al completar el ${encounterLabel(next.encounters)}.` : ''}`}
      </p>
      <div className="onb-cards" role="group" aria-label="Campeones">
        {pending.options.map((id) =>
          reveal ? <ChampionCard key={id} heroId={id} /> : <ChampionCard key={id} heroId={id} selected={picked === id} onSelect={() => setPicked(id)} />,
        )}
      </div>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      <div className="confirm-actions">
        <button type="button" className="db-btn" disabled={busy} onClick={onLater}>
          Más tarde
        </button>
        <button type="button" className="db-btn db-btn-primary" autoFocus={reveal} disabled={busy || (!reveal && !picked)} onClick={() => void unlock()}>
          {busy ? 'Guardando…' : reveal ? 'Desbloquear' : picked ? `Desbloquear ${DEFAULT_CONTENT.heroes[picked]!.name}` : 'Elige un campeón'}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * Champion ownership prompts, shown on the menu only: the first-time choice for a new player,
 * then any milestone unlock waiting to be claimed ("Más tarde" hides it until the next visit).
 */
export function ChampionPrompts() {
  const screen = useBattleStore((s) => s.screen);
  const profile = useBattleStore((s) => s.profile);
  const available = useBattleStore(useShallow(availableChampionsIn));
  const gate = useBattleStore((s) => s.guestGate);
  // "Más tarde" lasts until the menu is left (App remounts this per screen).
  const [later, setLater] = useState(false);
  // Never from a guest profile standing in for an account whose cloud state is not loaded.
  const authoritative = useBattleStore(championPromptsAllowed);
  if (screen !== 'MENU' || gate || !authoritative) return null;
  if (needsStartingChampion(profile)) return available.length ? <FirstChampionChoice /> : null;
  if (later || !pendingChampionUnlock(profile, available)) return null;
  return <ChampionUnlockDialog onLater={() => setLater(true)} />;
}
