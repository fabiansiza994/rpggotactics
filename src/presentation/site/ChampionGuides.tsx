import { useEffect } from 'react';
import { DEFAULT_CONTENT, type GameContent } from '../../game';
import { withArcher } from '../../game/data/archer';
import { withShapeshifterRelease } from '../../game/data/shapeshifter-release';
import { championsIn, championPortrait } from '../assets/champions';
import { GameIcon } from '../react/components/GameIcon';
import { SpellArt } from '../react/components/SpellArt';
import '../../styles/champion-guides.css';

export interface GuideRelease {
  warrior: boolean;
  shapeshifter: boolean;
  archer: boolean;
  rituals: boolean;
  archerCampaign: boolean;
}
export const guideRelease: GuideRelease = {
  warrior: import.meta.env.VITE_WARRIOR_ENABLED === '1',
  shapeshifter: import.meta.env.VITE_SHAPESHIFTER_ENABLED === '1',
  archer: import.meta.env.VITE_ARCHER_ENABLED === '1',
  rituals: import.meta.env.VITE_SUMMONER_RITUALS === '1',
  archerCampaign: import.meta.env.VITE_ARCHER_CAMPAIGN === '1',
};
export function guideContent(release: GuideRelease): GameContent {
  let content = DEFAULT_CONTENT;
  if (release.shapeshifter) content = withShapeshifterRelease(content);
  if (release.archer) content = withArcher(content);
  return content;
}
export function guideVisible(id: string, release: GuideRelease): boolean {
  return (
    id === 'mage' ||
    id === 'summoner' ||
    (id === 'warrior' && release.warrior) ||
    (id === 'shapeshifter' && release.shapeshifter) ||
    (id === 'archer' && release.archer)
  );
}
const copy: Record<
  string,
  { mechanics: [string, string][]; loop: string[]; cards: string[]; tip: string }
> = {
  mage: {
    mechanics: [
      [
        'Magia y control',
        'Combina daño directo con áreas y control. Una buena casilla importa tanto como un hechizo potente.',
      ],
      [
        'Movilidad',
        'Blink y Phase Step permiten reposicionarte con cartas. Revisa alcance y casillas válidas antes de comprometer tu energía.',
      ],
      [
        'Terreno',
        'Ice Wall modifica el campo: crea obstáculos para separar amenazas y proteger rutas.',
      ],
    ],
    loop: ['Leer amenazas', 'Controlar el espacio', 'Reposicionarse', 'Lanzar hechizos'],
    cards: ['magic_missile', 'ice_wall', 'blink', 'fireball'],
    tip: 'Reserva energía para escapar si tu próximo ataque no elimina la amenaza.',
  },
  summoner: {
    mechanics: [
      [
        'Capacidad de invocación',
        'Cada criatura ocupa capacidad. El límite del campeón aparece en sus atributos: tener energía no basta si toda la capacidad está ocupada.',
      ],
      [
        'Criaturas persistentes',
        'No expiran por rondas: permanecen hasta morir, ser retiradas por un efecto válido o terminar la batalla. Empiezan a actuar desde la ronda siguiente.',
      ],
      [
        'Posición y apoyo',
        'Protege a las criaturas más frágiles y usa apoyo sobre las que puedan sobrevivir. Las salidas de las invocaciones requieren que el héroe siga en juego.',
      ],
    ],
    loop: ['Elegir posición', 'Invocar', 'Proteger el vínculo', 'Presionar con criaturas'],
    cards: ['summon_chicken', 'summon_wolf', 'entangle'],
    tip: 'No llenes la capacidad sin pensar: deja espacio para la criatura que necesita el siguiente turno.',
  },
  warrior: {
    mechanics: [
      [
        'Guardia',
        'Es protección temporal: absorbe daño y dura hasta el comienzo de tu siguiente turno. Prepárala antes de exponerte.',
      ],
      [
        'Impulso',
        'Se obtiene al acabar un movimiento junto a un enemigo (una vez por turno) y al recibir golpes enemigos. Algunas cartas lo consumen para potenciar su efecto.',
      ],
      [
        'Carga y respuesta',
        'Carga y Empujón brutal permiten disputar posiciones. La carta Contraataque prepara una respuesta al primer golpe adyacente; no es una respuesta pasiva permanente.',
      ],
    ],
    loop: ['Acercarse', 'Preparar Guardia', 'Generar Impulso', 'Gastar en el momento justo'],
    cards: ['guard', 'warrior_charge', 'riposte', 'heavy_strike'],
    tip: 'Consulta el texto de cada carta: no todas gastan Impulso ni obtienen el mismo beneficio.',
  },
  shapeshifter: {
    mechanics: [
      [
        'Una forma activa',
        'Empiezas humanoide. Las cartas de transformación cambian tu forma; esta persiste hasta cambiarla o terminar la batalla.',
      ],
      [
        'Oso y Minotauro',
        'Oso favorece resistencia y defensa; Minotauro favorece presión y control cercano. Tu mazo decide qué herramientas y transformaciones llevas.',
      ],
      [
        'Requisitos de forma',
        'Algunas cartas solo se pueden jugar en su forma indicada. Transformarte comparte la energía habitual y no restaura vida ni elimina efectos automáticamente.',
      ],
    ],
    loop: [
      'Preparar la mano',
      'Elegir forma',
      'Usar cartas compatibles',
      'Cambiar según la amenaza',
    ],
    cards: ['qa_bear_form', 'qa_minotaur_form', 'qa_bear_claw', 'qa_axe_sweep'],
    tip: 'Combina transformaciones y cartas sin requisito para no depender de una sola mano.',
  },
  archer: {
    mechanics: [
      [
        'Presa',
        'Marca un enemigo como prioridad. Solo puede haber una Presa activa: marcar otra reemplaza la anterior. Algunas cartas reciben bonificaciones contra ella.',
      ],
      [
        'Concentración',
        'Empieza en 0. Se obtiene con acciones concretas: Disparo Certero al golpear a tu Presa desde Distancia Óptima, o Paso del Acechador al terminar sin enemigos adyacentes y con línea de visión hacia tu Presa. No se gana pasivamente ni con cualquier ataque.',
      ],
      [
        'Distancia Óptima',
        'Se mide en casillas horizontales y verticales, sin diagonales. Algunas cartas mejoran dentro del intervalo indicado abajo. Acercarte demasiado reduce esa ventaja.',
      ],
    ],
    loop: [
      'Marcar Presa',
      'Reposicionarse',
      'Ganar Concentración',
      'Alcanzar Distancia Óptima',
      'Disparo potenciado',
    ],
    cards: ['hunters_eye', 'true_shot', 'stalker_step', 'heart_shot'],
    tip: 'Tiro al Corazón exige preparación: asegúrate de tener Concentración, alcance y línea de visión antes de buscar la ejecución.',
  },
};

export function ChampionGuides({ release = guideRelease }: { release?: GuideRelease }) {
  useEffect(() => {
    // The landing is lazy-loaded: the browser's initial anchor jump precedes this section.
    const jump = () => {
      const id = window.location.hash.slice(1);
      if (id === 'champions' || id.startsWith('champion-')) {
        document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' });
      }
    };
    const frame = requestAnimationFrame(jump);
    window.addEventListener('hashchange', jump);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', jump);
    };
  }, []);
  const content = guideContent(release);
  const roster = championsIn(content).filter((c) => guideVisible(c.heroId, release));
  return (
    <section id="champions" className="official-section champion-guides">
      <span className="official-eyebrow">CAMPEONES · GUÍA DE JUEGO</span>
      <h2>
        Una identidad. <em>Tu forma de jugar.</em>
      </h2>
      <p>
        Cada campeón cambia la forma de jugar. Domina sus mecánicas, construye tu mazo y encuentra
        el estilo que mejor se adapte a ti.
      </p>
      <div className="guide-roster">
        {roster.map((c) => (
          <article key={c.heroId}>
            <img src={championPortrait(c.heroId)} alt="" loading="lazy" />
            <span className="official-eyebrow">{c.role}</span>
            <h3>{content.heroes[c.heroId]?.name}</h3>
            <p>{c.tagline}</p>
            <small>{c.identity.join(' · ')}</small>
            <a href={`#champion-${c.heroId}`}>
              Ver cómo funciona <span aria-hidden="true">↓</span>
            </a>
          </article>
        ))}
      </div>
      {roster.map((c) => {
        const hero = content.heroes[c.heroId];
        const guide = copy[c.heroId];
        if (!guide || !hero) return null;
        const cards = guide.cards
          .map((id) => content.cards[id])
          .filter((card): card is NonNullable<typeof card> => !!card);
        return (
          <article id={`champion-${c.heroId}`} className="champion-guide" key={c.heroId}>
            <div className="guide-identity">
              <img
                src={championPortrait(c.heroId)}
                alt={hero.name}
                loading="lazy"
                width="400"
                height="500"
              />
              <span className="official-eyebrow">{c.role}</span>
              <h3>{hero.name}</h3>
              <p>{c.description}</p>
              <dl className="guide-stats">
                <div>
                  <dt>Vida</dt>
                  <dd>{hero.maxHp}</dd>
                </div>
                <div>
                  <dt>Energía</dt>
                  <dd>{hero.maxEnergy}</dd>
                </div>
                <div>
                  <dt>Movimiento</dt>
                  <dd>{hero.movePoints}</dd>
                </div>
                {hero.summonCapacity && (
                  <div>
                    <dt>Capacidad</dt>
                    <dd>{hero.summonCapacity}</dd>
                  </div>
                )}
              </dl>
              <h4>Fortalezas</h4>
              <ul>
                {c.strengths.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <h4>Debilidades</h4>
              <ul>
                {c.weaknesses.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div className="guide-explanation">
              <h4>Mecánicas principales</h4>
              {guide.mechanics.map(([title, text], i) => (
                <div className="guide-mechanic" key={title}>
                  <GameIcon name={i === 0 ? 'target' : i === 1 ? 'arcane' : 'shield'} />
                  <div>
                    <h5>{title}</h5>
                    <p>{text}</p>
                  </div>
                </div>
              ))}
              {hero.focus && (
                <p className="guide-fact">
                  Concentración máxima: <strong>{hero.focus.max}</strong> · Distancia Óptima:{' '}
                  <strong>
                    {hero.focus.optimalRange.min}–{hero.focus.optimalRange.max} casillas
                  </strong>
                  . {content.cards.heart_shot?.name}: requiere y consume{' '}
                  <strong>{content.cards.heart_shot?.focusCost}</strong> Concentración.
                </p>
              )}
              {c.heroId === 'summoner' && release.rituals && (
                <p className="guide-fact">
                  <strong>Rituales:</strong> reúne las piezas distintas del ritual en el altar.
                  Cuando esté listo, utiliza su acción de invocación; el altar indica los requisitos
                  pendientes.
                </p>
              )}
              <h4>Cómo jugarlo</h4>
              <ol className="guide-loop">
                {guide.loop.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <h4>Cartas destacadas</h4>
              <div className="guide-cards">
                {cards.map((card) => (
                  <article key={card.id}>
                    <div className="guide-card-art">
                      <SpellArt spell={card.presentation?.visualKey ?? card.id} cardId={card.id} />
                    </div>
                    <h5>{card.name}</h5>
                    <small>
                      {card.cost} energía · {card.rarity}
                    </small>
                    <p>{card.rulesText}</p>
                  </article>
                ))}
              </div>
              {c.heroId === 'archer' && release.archerCampaign && (
                <div className="guide-arrows">
                  <h4>Flechas especiales</h4>
                  <p>
                    Recompensas de Sendero del Cazador. Debes obtenerlas en su campaña para
                    incorporarlas al mazo.
                  </p>
                  {['ice_arrow', 'fire_arrow', 'poison_arrow', 'rebound_arrow', 'smoke_arrow'].map(
                    (id) => {
                      const card = content.cards[id];
                      return card ? (
                        <details key={id}>
                          <summary>{card.name}</summary>
                          <p>{card.rulesText}</p>
                        </details>
                      ) : null;
                    },
                  )}
                </div>
              )}
              <aside className="guide-tip">
                <strong>Consejo rápido</strong>
                <p>{guide.tip}</p>
              </aside>
              <a href="#champions">Volver a campeones ↑</a>
            </div>
          </article>
        );
      })}
    </section>
  );
}
