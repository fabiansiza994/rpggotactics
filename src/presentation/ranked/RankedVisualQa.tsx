import { PvpVictoryLines } from '../dialogue/DialogueGates';
import { PRESENTATION_CONTENT } from '../qa/shapeshifter/runtime';
import { useState } from 'react';
import {
  RANKED_RULES,
  RANKED_SEASON,
  RANKED_TIERS,
  applyRp,
  tierFloorRp,
  rankFor,
} from '../../game/ranked/ranked';
import { PvpLobby } from '../pvp/PvpLobby';
import { PvpHistory } from '../pvp/PvpHistory';
import { HistoryAccessContext } from '../pvp/HistoryAccess';
import type { PvpHistoryItem } from '../pvp/historyApi';
import { RankedPanel, RankedResult } from './RankedViews';
import { RankShield } from './RankShield';
import type { RankedSnapshot } from './rankedApi';
import '../../styles/pvp.css';

export const QA_RANKED_RESULTS: Record<string, RankedSnapshot['outcome']> = {
  victory: {
    outcome: 'WIN',
    rpBefore: 920,
    rpAfter: applyRp(920, RANKED_RULES.delta.WIN),
    rpDelta: RANKED_RULES.delta.WIN,
    capped: false,
    milestones: [],
  },
  defeat: {
    outcome: 'LOSS',
    rpBefore: 940,
    rpAfter: applyRp(940, RANKED_RULES.delta.LOSS),
    rpDelta: RANKED_RULES.delta.LOSS,
    capped: false,
    milestones: [],
  },
  division: {
    outcome: 'WIN',
    rpBefore: 990,
    rpAfter: 1010,
    rpDelta: 20,
    capped: false,
    milestones: [],
  },
  promotion: {
    outcome: 'WIN',
    rpBefore: 880,
    rpAfter: 900,
    rpDelta: 20,
    capped: false,
    milestones: [
      { tierId: 'GOLD', crystals: RANKED_TIERS.find((t) => t.id === 'GOLD')!.milestoneCrystals },
    ],
  },
  demotion: {
    outcome: 'LOSS',
    rpBefore: 900,
    rpAfter: 888,
    rpDelta: -12,
    capped: false,
    milestones: [],
  },
  capped: { outcome: 'WIN', rpBefore: 940, rpAfter: 940, rpDelta: 0, capped: true, milestones: [] },
  abandon: {
    outcome: 'ABANDON',
    rpBefore: 940,
    rpAfter: 920,
    rpDelta: -20,
    capped: false,
    milestones: [],
  },
  pending: null,
};
const historyMatch: PvpHistoryItem = {
  matchId: 'qa-ranked-visual',
  playedAt: Date.UTC(2026, 9, 19, 12),
  mode: 'DUEL',
  result: 'WIN',
  reason: 'CHAMPION_DEFEATED',
  opponent: { username: 'Rival QA', deleted: false, champion: 'archer' },
  myChampion: 'mage',
  rounds: 7,
  durationSeconds: 268,
  queue: 'RANKED',
  ranked: { rpBefore: 880, rpAfter: 900, rpDelta: 20, capped: false },
};
const tally = { matches: 1, wins: 1, losses: 0, draws: 0, winRate: 100 };
const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });
const historyAccess = {
  history: () => ok({ matches: [historyMatch], nextCursor: null }),
  stats: () =>
    ok({
      overall: tally,
      byChampion: [{ ...tally, champion: 'mage' }],
      byMode: [{ ...tally, mode: 'DUEL' }],
    }),
  detail: () =>
    ok({
      ...historyMatch,
      startedAt: Date.UTC(2026, 9, 19, 11, 55),
      mapId: 'classic',
      me: { username: 'Jugador QA', champion: 'mage' },
      firstTurn: 'ME' as const,
      score: null,
    }),
  headToHead: () =>
    ok({
      opponent: { username: 'Rival QA' },
      matchesPlayed: 1,
      myWins: 1,
      theirWins: 0,
      draws: 0,
      winRate: 100,
      lastPlayedAt: historyMatch.playedAt,
      byChampion: [{ ...tally, champion: 'mage' }],
      byMode: [{ ...tally, mode: 'DUEL' }],
    }),
};
/** Local presentation fixtures only: no API overrides, queue tickets, wallets, storage or sockets. */
export function RankedVisualQa() {
  const [scene, setScene] = useState('lobby'),
    [rp, setRp] = useState(0),
    [queueKind, setQueueKind] = useState<'CASUAL' | 'RANKED'>('RANKED');
  const [since, setSince] = useState(() => Date.now());
  const changeScene = (next: string) => {
    setScene(next);
    if (next === 'queue') setSince(Date.now());
  };
  const snapshot: RankedSnapshot = { rp: [rp, 300], outcome: QA_RANKED_RESULTS[scene] ?? null };
  const panel = (
    <RankedPanel
      profile={{
        enabled: true,
        rp,
        wins: Math.floor(rp / 20),
        losses: 0,
        draws: 0,
        milestones: [],
        queue: { state: 'IDLE' },
      }}
      queue={scene === 'queue' ? { state: 'SEARCHING', heroId: 'mage', since } : { state: 'IDLE' }}
      busy={false}
      error=""
      blocked={null}
      championName="Mago"
      onSearch={() => changeScene('queue')}
      onCancel={() => changeScene('lobby')}
    />
  );
  return (
    <div className="ranked-visual-qa">
      <header className="ranked-qa-tools">
        <span>QA VISUAL · SIN RED</span>
        <label>
          Escena{' '}
          <select
            aria-label="Escena QA"
            value={scene}
            onChange={(e) => changeScene(e.target.value)}
          >
            {[
              'lobby',
              'queue',
              'vs',
              'victory',
              'defeat',
              'division',
              'promotion',
              'demotion',
              'capped',
              'abandon',
              'pending',
              'history',
              'shields',
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Rango{' '}
          <select aria-label="Rango QA" value={rp} onChange={(e) => setRp(Number(e.target.value))}>
            {RANKED_TIERS.map((tier, i) => (
              <option key={tier.id} value={tierFloorRp(i)}>
                {rankFor(tierFloorRp(i)).label}
              </option>
            ))}
          </select>
        </label>
        {scene === 'queue' && (
          <button onClick={() => changeScene('vs')}>Encontrar rival (QA)</button>
        )}
      </header>
      {scene === 'shields' ? (
        <main className="ranked-qa-shields">
          {RANKED_TIERS.map((tier, i) => (
            <article key={tier.id}>
              <RankShield rp={tierFloorRp(i)} size="lg" />
              <h2>{tier.name}</h2>
              <div>
                {[0, 100, 200].map((offset) => (
                  <RankShield key={offset} rp={tierFloorRp(i) + offset} size="sm" />
                ))}
              </div>
            </article>
          ))}
        </main>
      ) : scene === 'history' ? (
        <HistoryAccessContext.Provider value={historyAccess}>
          <PvpHistory onBack={() => changeScene('lobby')} />
        </HistoryAccessContext.Provider>
      ) : ['lobby', 'queue', 'vs'].includes(scene) ? (
        <PvpLobby
          room={
            scene === 'vs'
              ? {
                  code: 'QA-LOCAL',
                  mode: 'DUEL',
                  mapId: 'classic',
                  seat: 0,
                  members: [
                    { name: 'Jugador QA', heroId: 'mage', ready: false, connected: true },
                    { name: 'Rival QA', heroId: 'archer', ready: true, connected: true },
                  ],
                  ranked: snapshot,
                }
              : null
          }
          hero="mage"
          mode="DUEL"
          mapId="classic"
          code=""
          busy={false}
          network={scene === 'vs' ? 'Conectado' : 'Sin sala'}
          error=""
          onHero={() => {}}
          onMode={() => {}}
          onMap={() => {}}
          onCode={() => {}}
          onAction={() => {}}
          onExit={() => changeScene('lobby')}
          onHistory={() => changeScene('history')}
          queueKind={queueKind}
          onQueueKind={setQueueKind}
          rankedSlot={panel}
        />
      ) : (
        <main className="ranked-qa-result pvp-overlay">
          <h2>Resultado</h2>
          <RankedResult key={scene} ranked={snapshot} />
          {snapshot.outcome && <PvpVictoryLines content={PRESENTATION_CONTENT} matchKey="ranked-visual-only" heroes={['mage','archer']} winnerSeat={snapshot.outcome.outcome === 'WIN' ? 0 : 1} />}
          <div className="pvp-result-actions"><button onClick={() => changeScene('lobby')}>Salir</button>          <button onClick={() => changeScene('lobby')}>Buscar otra partida</button></div>
          <small>{RANKED_SEASON.name} · muestra visual, no se aplica RP</small>
        </main>
      )}
    </div>
  );
}
