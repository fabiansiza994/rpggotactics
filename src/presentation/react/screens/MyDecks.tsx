import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  deckSummaries,
  neutralCount,
  heroProfile,
  DECK_RULES,
  DEFAULT_DECK_SLOTS_PER_CHAMPION,
  DECK_NAME_MAX,
} from '../../../game';
import { PRESENTATION_CONTENT as CONTENT } from '../../qa/shapeshifter/runtime';
import { useBattleStore, type DeckActionResult } from '../../store/battleStore';
import '../../../styles/my-decks.css';
import { championPortrait } from '../../assets/champions';
import { FINAL_CARD_ART, CARD_PAINTINGS } from '../../assets/paintedAssets';
const errors: Record<string, string> = {
  DECK_LIMIT: 'Ya tienes 3 mazos. Elimina uno para crear otro.',
  LAST_DECK: 'Debes conservar al menos un mazo.',
  INVALID_NAME: 'Escribe un nombre de 1 a 32 caracteres.',
  UNKNOWN_DECK: 'Este mazo ya no existe. Actualiza la colección.',
  INVALID_DECK: 'El mazo no es válido.',
  CHAMPION_LOCKED: 'Campeón no disponible.',
  CLOUD: 'No se pudo guardar. Inténtalo de nuevo.',
};
export const deckActionError = (r: Extract<DeckActionResult, { ok: false }>) =>
  r.message ?? errors[r.error] ?? 'No se pudo completar la acción.';
export function DeckNameDialog({
  name,
  onClose,
  onSave,
  busy,
  error,
}: {
  name: string;
  onClose: () => void;
  onSave: (name: string) => void;
  busy: boolean;
  error: string;
}) {
  const [value, setValue] = useState(name);
  return (
    <div
      className="md-dialog-backdrop"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="md-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Renombrar mazo"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value);
        }}
      >
        <h2>Nombre del mazo</h2>
        <label>
          Nombre
          <input
            autoFocus
            value={value}
            maxLength={DECK_NAME_MAX}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button disabled={busy || !value.trim()}>Guardar nombre</button>
        </div>
      </form>
    </div>
  );
}
function DeckOverflow({
  name,
  busy,
  children,
}: {
  name: string;
  busy: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !ref.current?.contains(e.target) && ref.current)
        ref.current.open = false;
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return (
    <details
      className="md-overflow"
      ref={ref}
      name="deck-actions"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && ref.current) {
          ref.current.open = false;
          ref.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary
        aria-label={`Acciones de ${name}`}
        aria-disabled={busy}
        onClick={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        ⋯
      </summary>
      <div
        className="md-actions"
        onClick={(e) => {
          if ((e.target as Element).closest('button') && ref.current) ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
export function MyDecks({ onEdit }: { onEdit: (id: string) => void }) {
  const profile = useBattleStore((s) => s.profile),
    heroId = useBattleStore((s) => s.deckHeroId);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [rename, setRename] = useState<{ id: string; name: string } | null>(null),
    [remove, setRemove] = useState<{ id: string; name: string } | null>(null);
  const decks = deckSummaries(profile, heroId, CONTENT, DECK_RULES),
    full = decks.length >= DEFAULT_DECK_SLOTS_PER_CHAMPION;
  async function run(call: () => Promise<DeckActionResult>, edit = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await call();
      if (!r.ok) setError(deckActionError(r));
      else {
        setRename(null);
        setRemove(null);
        if (edit) onEdit(r.deckId);
      }
    } catch {
      setError('No se pudo conectar. Conservamos tus mazos.');
    } finally {
      setBusy(false);
    }
  }
  const store = useBattleStore.getState();
  return (
    <main className="my-decks rpg-scroll-y" data-champion={heroId}>
      <header>
        <button onClick={() => store.closeDeckBuilder()}>‹ Volver</button>
        <div>
          <span className="menu-eyebrow">TU ARSENAL</span>
          <h1>Mis mazos — {CONTENT.heroes[heroId]?.name}</h1>
          <p>Campaña e historias usan el predeterminado.</p>
        </div>
        <span className="md-slot-count">
          <strong>
            {decks.length}/{DEFAULT_DECK_SLOTS_PER_CHAMPION}
          </strong>{' '}
          mazos
        </span>
      </header>
      {error && !rename && <p role="alert">{error}</p>}
      <section className="md-grid" aria-label="Mazos del campeón">
        {decks.map((d, index) => {
          const saved = heroProfile(profile, heroId, CONTENT).decks.find(
            (deck) => deck.id === d.deckId,
          );
          const signature = saved?.cards
            .map((entry) => CONTENT.cards[entry.cardId])
            .filter(
              (card) =>
                card && !!(FINAL_CARD_ART[card.id] || CARD_PAINTINGS[card.presentation.visualKey]),
            )
            .sort((a, b) => b!.cost - a!.cost)[0];
          const cover =
            signature &&
            (FINAL_CARD_ART[signature.id] || CARD_PAINTINGS[signature.presentation.visualKey]);
          return (
            <article key={d.deckId} className="md-card" data-default={d.isDefault}>
              <div className="md-cover" aria-hidden="true">
                <span className="md-spine">{String(index + 1).padStart(2, '0')} · RPG GO</span>
                <img
                  className="md-cover-art"
                  src={cover || championPortrait(heroId)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span className="md-cover-vignette" />
                <span className="md-champion-seal">
                  <img src={championPortrait(heroId)} alt="" loading="lazy" decoding="async" />
                </span>
                <span className="md-cover-caption">{CONTENT.heroes[heroId]?.name} · Arsenal</span>
              </div>
              {d.isDefault && (
                <span className="md-default">
                  <span aria-hidden="true">★</span> Predeterminado
                </span>
              )}
              <div className="md-card-heading">
                <h2>{d.name}</h2>
              </div>
              <div className="md-card-info">
                {saved && DECK_RULES.maxNeutralCards !== undefined && neutralCount(saved.cards, CONTENT) > DECK_RULES.maxNeutralCards && (
                  <p role="alert">Excede el máximo de {DECK_RULES.maxNeutralCards} cartas neutrales ({neutralCount(saved.cards, CONTENT)}). Edita el mazo para poder jugar.</p>
                )}
                <p data-valid={d.valid}>
                  <span className="md-valid-dot" aria-hidden="true" />
                  {d.cardCount}/{d.maxCards} ·{' '}
                  {d.valid ? 'Válido' : d.cardCount < d.maxCards ? 'Incompleto' : 'Inválido'}
                </p>
                {d.updatedAt ? (
                  <small>Modificado {new Date(d.updatedAt).toLocaleString()}</small>
                ) : (
                  <small>Listo para tu próxima aventura</small>
                )}
              </div>
              <button className="md-primary" disabled={busy} onClick={() => onEdit(d.deckId)}>
                Editar <span aria-hidden="true">↗</span>
              </button>
              <DeckOverflow name={d.name} busy={busy}>
                <button
                  disabled={busy}
                  onClick={() => {
                    setError('');
                    setRename({ id: d.deckId, name: d.name });
                  }}
                >
                  Renombrar
                </button>
                <button
                  disabled={busy || full}
                  title={full ? 'Máximo 3 mazos por campeón' : undefined}
                  onClick={() => void run(() => store.duplicateDeck(heroId, d.deckId), true)}
                >
                  Duplicar
                </button>
                <button
                  disabled={busy || d.isDefault}
                  onClick={() => void run(() => store.setDefaultDeck(heroId, d.deckId))}
                >
                  Hacer predeterminado
                </button>
                <button
                  disabled={busy || decks.length === 1}
                  title={decks.length === 1 ? 'No puedes eliminar el último mazo' : undefined}
                  onClick={() => setRemove({ id: d.deckId, name: d.name })}
                >
                  Eliminar
                </button>
              </DeckOverflow>
            </article>
          );
        })}
        {!full && (
          <button
            className="md-create"
            disabled={busy}
            onClick={() => void run(() => store.createDeck(heroId), true)}
          >
            <span className="md-empty-emblem" aria-hidden="true">
              +
            </span>
            <strong>Crear nuevo mazo</strong>
            <span>Un nuevo plan de batalla</span>
            <small>
              {DEFAULT_DECK_SLOTS_PER_CHAMPION - decks.length}{' '}
              {DEFAULT_DECK_SLOTS_PER_CHAMPION - decks.length === 1
                ? 'espacio disponible'
                : 'espacios disponibles'}
            </small>
          </button>
        )}
      </section>
      {full && (
        <p role="status">Máximo 3 mazos por campeón. Elimina uno para liberar un espacio.</p>
      )}
      {rename && (
        <DeckNameDialog
          name={rename.name}
          busy={busy}
          error={error}
          onClose={() => setRename(null)}
          onSave={(name) => void run(() => store.renameDeck(heroId, rename.id, name))}
        />
      )}
      {remove && (
        <div className="md-dialog-backdrop">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-label="Eliminar mazo"
            className="md-dialog"
          >
            <h2>¿Eliminar «{remove.name}»?</h2>
            <p>Esta acción no elimina cartas de tu colección.</p>
            <button disabled={busy} onClick={() => setRemove(null)}>
              Cancelar
            </button>
            <button
              disabled={busy}
              onClick={() => void run(() => store.deleteDeck(heroId, remove.id))}
            >
              Eliminar mazo
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
