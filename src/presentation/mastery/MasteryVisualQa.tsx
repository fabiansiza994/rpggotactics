import { PvpVictoryLines } from '../dialogue/DialogueGates';
import { useState } from 'react';
import { MASTERY_CHAMPIONS, MASTERY_TITLES, masteryFor } from '../../game/mastery/mastery';
import { championPortrait } from '../assets/champions';
import { PRESENTATION_CONTENT } from '../qa/shapeshifter/runtime';
import { MasteryPanelContent, MasteryBadge, type EnabledMastery } from './MasteryViews';
import { MasteryGainView } from './MasteryFeedback';
import { RankedResult, RankedIntro } from '../ranked/RankedViews';
import { PvpLobby } from '../pvp/PvpLobby';
import '../../styles/pvp.css';
const fixture = (heroId: string, xp: number, titleId: string | null = null): EnabledMastery => ({
  enabled: true,
  champions: { [heroId]: { xp, level: masteryFor(xp).level } },
  equippedTitleId: titleId,
  rewards: [],
  titles: MASTERY_TITLES.map((t) => ({
    ...t,
    unlocked: t.championId === heroId && t.requiredMastery <= masteryFor(xp).level,
    equipped: t.id === titleId,
  })),
});
export function MasteryVisualQa() {
  const [hero, setHero] = useState('archer'),
    [xp, setXp] = useState(0),
    [title, setTitle] = useState<string | null>(null),
    [scene, setScene] = useState('champion');
  const state = fixture(hero, xp, title),
    name = PRESENTATION_CONTENT.heroes[hero]?.name ?? hero;
  const before = fixture(hero, 1500),
    after = {
      ...fixture(hero, 1545),
      rewards: [{ heroId: hero, level: 7, crystals: 75, reachedAt: 1 }],
    };
  const player = {
      name: 'Jugador QA',
      heroId: hero,
      ready: false,
      connected: true,
      titleId: `mastery.${hero}.7`,
    },
    rival = {
      name: 'Rival QA',
      heroId: 'mage',
      ready: true,
      connected: true,
      titleId: 'mastery.mage.9',
    };
  return (
    <div className="mastery-visual-lab">
      <nav aria-label="Controles QA">
        <b>MAESTRÍA · QA LOCAL · SIN RED</b>
        <label>
          Escena{' '}
          <select aria-label="Escena QA" value={scene} onChange={(e) => setScene(e.target.value)}>
            {['champion', 'emblems', 'unlock', 'post-battle', 'pvp', 'ranked'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Campeón{' '}
          <select
            aria-label="Campeón QA"
            value={hero}
            onChange={(e) => {
              setHero(e.target.value);
              setTitle(null);
            }}
          >
            {MASTERY_CHAMPIONS.map((id) => (
              <option key={id} value={id}>
                {PRESENTATION_CONTENT.heroes[id]?.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nivel{' '}
          <select aria-label="Nivel QA" value={xp} onChange={(e) => setXp(Number(e.target.value))}>
            <option value={0}>M1</option>
            <option value={1600}>M7</option>
            <option value={3625}>M10</option>
          </select>
        </label>
      </nav>
      {scene === 'champion' ? (
        <main className="mastery-qa-champion">
          <aside>
            <img src={championPortrait(hero)} alt={name} />
            <h1>{name}</h1>
            <p>Legado del campeón</p>
          </aside>
          <div className="mastery-qa-detail">
            <MasteryPanelContent
              key={hero}
              heroId={hero}
              state={state}
              onEquip={async (id) => {
                setTitle(id);
                return null;
              }}
            />
          </div>
        </main>
      ) : scene === 'emblems' ? (
        <main className="mastery-qa-emblems">
          {[1, 3, 5, 8, 10].map((level) => (
            <article key={level}>
              <MasteryBadge level={level} />
              <h2>Maestría {level}</h2>
            </article>
          ))}
        </main>
      ) : scene === 'unlock' || scene === 'post-battle' ? (
        <main
          className={
            scene === 'post-battle' ? 'pvp-overlay mastery-qa-result' : 'mastery-qa-reveal'
          }
        >
          {scene === 'post-battle' ? (
            <RankedResult
              ranked={{
                rp: [940, 740],
                outcome: {
                  outcome: 'WIN',
                  rpBefore: 940,
                  rpAfter: 960,
                  rpDelta: 20,
                  capped: false,
                  milestones: [],
                },
              }}
            />
          ) : (
            <h1>Victoria</h1>
          )}
          <MasteryGainView
            compact={scene === 'post-battle'}
            before={before}
            after={after}
            heroId={hero}
            heroName={name}
          />
          {scene === 'post-battle' && (
            <PvpVictoryLines
              content={PRESENTATION_CONTENT}
              matchKey="mastery-visual-only"
              heroes={[hero, 'mage']}
              winnerSeat={0}
            />
          )}
          <button onClick={() => setScene('champion')}>Continuar</button>
        </main>
      ) : scene === 'ranked' ? (
        <main className="mastery-qa-reveal">
          <RankedIntro
            ranked={{ rp: [940, 740], outcome: null }}
            seat={0}
            names={[player.name, rival.name]}
            champions={[hero, 'mage']}
            titles={[player.titleId, rival.titleId]}
          />
        </main>
      ) : (
        <PvpLobby
          room={{
            code: 'QAONLY01',
            seat: 0,
            members: [player, rival],
            mode: 'DUEL',
            mapId: 'classic',
          }}
          hero={hero}
          mode="DUEL"
          mapId="classic"
          code="QAONLY01"
          busy={false}
          network="Conectado"
          error=""
          onHero={() => {}}
          onMode={() => {}}
          onMap={() => {}}
          onCode={() => {}}
          onAction={() => {}}
          onExit={() => {}}
        />
      )}
    </div>
  );
}
