import { characterDefinition } from '../../assets/characterDefinitions';
import { useId } from 'react';
import { CARD_IDENTITY } from '../../assets/visualIdentity';
import { CARD_PAINTINGS, FINAL_CARD_ART } from '../../assets/paintedAssets';
import { ArcherCardArt, hasArcherCardArt } from '../../qa/archer/ArcherCardArt';
import { RANKED_TRACK_CARDS } from '../../../game/data/ranked-cards';

const RANKED_ART_PENDING = new Set(RANKED_TRACK_CARDS.map((c) => c.id));

/** Shared engraving primitives; illustrations are decorative, never targeting previews. */
function Rune({
  x = 120,
  y = 102,
  rx = 58,
  ry = 16,
}: {
  x?: number;
  y?: number;
  rx?: number;
  ry?: number;
}) {
  return (
    <g fill="none" stroke="currentColor">
      <ellipse cx={x} cy={y} rx={rx} ry={ry} strokeWidth="1.5" />
      <ellipse cx={x} cy={y} rx={rx * 0.8} ry={ry * 0.8} opacity=".5" />
      <path
        d={`M${x - rx - 8} ${y}h16m${rx * 2 - 16} 0h16M${x} ${y - ry - 6}v12m0 ${ry * 2 - 12}v12`}
        opacity=".7"
      />
    </g>
  );
}
function Figure({
  x = 120,
  y = 24,
  scale = 1,
  opacity = 1,
}: {
  x?: number;
  y?: number;
  scale?: number;
  opacity?: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
      <path
        d="M-15 21Q-29 47-34 80L-16 72-17 85 2 79 27 83 18 46 12 20Z"
        fill="#182b43"
        stroke="#9db4c8"
      />
      <path d="M-15 23-18 10-3-9 14 7 15 24 1 33Z" fill="#3c5c79" stroke="#c3b284" />
      <path d="M-10 13 0 4 9 14 4 27-5 25Z" fill="#090f1d" />
      <path d="M-6 17h4m5 0h4" stroke="#ccf9ff" strokeWidth="2" />
      <path d="M-10 32-18 72M8 32l13 44" stroke="#baa36d" />
      <path d="M22 80 25 16" stroke="#ccb784" strokeWidth="3" />
      <path d="m25 0 7 12-7 12-7-12Z" fill="#b8e5f0" />
    </g>
  );
}
function Shard({ x, y, h, w = 14 }: { x: number; y: number; h: number; w?: number }) {
  return (
    <g>
      <path
        d={`M${x - w} ${y}l-2 ${-h * 0.65} ${w + 2} ${-h * 0.35} ${w} ${h * 0.4} -1 ${h * 0.65}Z`}
        fill="#42899e"
        stroke="#c7edf0"
      />
      <path d={`M${x} ${y - h}v${h * 0.8}l${w - 1} ${h * 0.25} 1 ${-h * 0.65}Z`} fill="#9bdae0" />
      <path d={`M${x} ${y - h}v${h * 0.8}l${-w} ${h * 0.2}`} fill="none" stroke="#e0ffff" />
    </g>
  );
}
export function SpellArt({ spell, cardId }: { spell: string; cardId?: string }) {
  const id = useId().replace(/:/g, '');
  // Archer cards: dedicated illustrations unless a final painting is registered for the id.
  if (hasArcherCardArt(cardId) && !FINAL_CARD_ART[cardId!]) return <ArcherCardArt cardId={cardId!} />;
  // Ranked Reward Track cards: explicit placeholder until Codex delivers their own paintings.
  if (cardId && RANKED_ART_PENDING.has(cardId) && !FINAL_CARD_ART[cardId])
    return <span className="painted-card-art" data-art-pending="true" data-ranked-art-pending="true" role="img" aria-label="Arte propio pendiente"
      style={{display:'grid',placeItems:'center',background:'#1b1a26',color:'#dac59c',fontSize:13,textAlign:'center',letterSpacing:'.08em'}}>ARTE PENDIENTE<br />RANKED</span>;
  if (cardId?.startsWith('qa_') && !FINAL_CARD_ART[cardId])
    return <span className="painted-card-art" data-art-pending="true" role="img" aria-label="Arte propio pendiente"
      style={{display:'grid',placeItems:'center',background:'#152128',color:'#dac59c',fontSize:14,textAlign:'center'}}>ARTE PENDIENTE</span>;
  const painting = (cardId && FINAL_CARD_ART[cardId]) || CARD_PAINTINGS[spell];
  if (painting)
    return (
      <img
        className="painted-card-art"
        data-tactical-art={painting.startsWith('/art/tactical-cards/') || painting.startsWith('/art/arsenal-cards/') || undefined}
        data-final-art={!!(cardId && FINAL_CARD_ART[cardId])}
        src={painting}
        alt=""
        draggable={false}
      />
    );
  const tone = CARD_IDENTITY[spell]?.tone ?? '#acbada';
  let subject;
  switch (spell) {
    case 'summon_chicken':
      subject = (
        <>
          <Rune y={114} />
          <g transform="translate(120 82) scale(1.15)">
            {characterDefinition('chicken').shapes.map((shape, i) => (
              <path
                key={i}
                d={shape.d}
                fill={shape.fill}
                stroke={shape.stroke}
                strokeWidth={shape.width}
              />
            ))}
          </g>
        </>
      );
      break;
    case 'fireball':
      subject = (
        <>
          <path d="M13 125Q82 116 125 49L168 62Q110 125 13 125Z" fill="#8c3927" />
          <path d="M25 120Q78 100 102 60L123 80 149 57Q132 107 25 120Z" fill="#e57d39" />
          <path d="M49 114Q99 98 139 61" fill="none" stroke="#ffe2a0" strokeWidth="7" />
          <circle cx="166" cy="55" r="33" fill="#9c4129" />
          <circle cx="166" cy="55" r="25" fill="#f69c42" />
          <path
            d="M154 36Q181 27 185 53Q187 76 164 75Q145 72 150 58Q172 72 177 50Q169 36 154 47Z"
            fill="#fff0b2"
          />
          <path
            d="M131 39Q175 7 201 48M131 78Q178 101 202 55"
            fill="none"
            stroke="#efb965"
            strokeWidth="2"
          />
        </>
      );
      break;
    case 'flame_tile':
      subject = (
        <>
          <path d="m48 99 73-28 76 25-72 37Z" fill="#342c29" stroke="#ae7951" />
          <path
            d="m72 104 41-14 13 17 35-8m-41-19 8 35"
            fill="none"
            stroke="#ed9b4e"
            strokeWidth="3"
          />
          {[
            [-26, 14],
            [0, 0],
            [28, 9],
          ].map(([x, y], i) => (
            <g key={i} transform={`translate(${120 + x!} ${y})`}>
              <path d="M-14 98Q-28 69-7 52Q-8 69 5 35Q29 76 12 100Z" fill="#c75b2c" />
              <path d="M-5 96Q-15 80 4 62Q17 87 4 99Z" fill="#ffe0a0" />
            </g>
          ))}
        </>
      );
      break;
    case 'ice_wall':
      subject = (
        <>
          <Rune y={119} rx={98} ry={13} />
          {[
            [-64, 54],
            [-31, 79],
            [0, 106],
            [31, 83],
            [62, 58],
          ].map(([x, h], i) => (
            <Shard key={i} x={120 + x!} y={119} h={h!} w={15} />
          ))}
          <path d="m18 124 35-7m137 1 34 7" stroke="#bfe8ed" />
        </>
      );
      break;
    case 'frost_nova':
      subject = (
        <>
          <Figure y={41} scale={0.6} />
          {[37, 62, 91].map((r) => (
            <Rune key={r} y={100} rx={r} ry={r * 0.27} />
          ))}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <Shard
              key={i}
              x={120 + Math.cos((i * Math.PI) / 4) * 84}
              y={103 + Math.sin((i * Math.PI) / 4) * 23}
              h={18 + (i % 3) * 6}
              w={5}
            />
          ))}
          <path d="M120 78v49M86 90l69 24m0-24-69 24" stroke="#d9fbff" strokeWidth="2" />
        </>
      );
      break;
    case 'blink':
      subject = (
        <>
          <Rune x={65} y={117} rx={38} ry={11} />
          <Rune x={183} y={89} rx={38} ry={11} />
          <Figure x={63} y={39} scale={0.85} opacity={0.6} />
          <Figure x={184} y={14} scale={0.85} />
          {Array.from({ length: 12 }, (_, i) => (
            <path
              key={i}
              d={`m${91 + i * 6} ${95 - i * 4} 4-4 4 4-4 4Z`}
              fill={tone}
              opacity={0.25 + i * 0.05}
            />
          ))}
          <path d="M62 115Q122 126 185 88" fill="none" stroke="#e2d4ff" />
        </>
      );
      break;
    case 'phase_step':
      subject = (
        <>
          <Figure x={85} y={27} opacity={0.18} />
          <Figure x={110} y={27} opacity={0.35} />
          <Figure x={140} y={27} />
          <path
            d="M44 83Q112 109 208 59M37 95Q114 124 208 77"
            fill="none"
            stroke={tone}
            strokeWidth="2"
          />
          <Rune x={134} y={115} rx={68} ry={10} />
        </>
      );
      break;
    case 'barrier':
      subject = (
        <>
          <Figure x={120} y={37} scale={0.78} />
          <path
            d="M120 14 174 34 170 81Q161 110 120 131Q77 110 70 81L66 34Z"
            fill="#d4b768"
            fillOpacity=".09"
            stroke="#ead5a0"
            strokeWidth="3"
          />
          <path
            d="M120 23 164 40 160 80Q148 110 120 119Q87 101 80 80L77 41Z"
            fill="none"
            stroke="#ae8f54"
          />
          <Rune y={115} rx={80} ry={17} />
        </>
      );
      break;
    case 'force_push':
      subject = (
        <>
          <Figure x={61} y={38} scale={0.72} />
          <path
            d="M92 38Q126 70 92 108M107 27Q149 69 107 122M126 19Q176 69 126 130"
            fill="none"
            stroke={tone}
            strokeWidth="4"
          />
          <path d="M91 72h105m-19-15 20 15-20 15" fill="none" stroke="#ecf3ef" strokeWidth="3" />
          <path d="m195 59 13 2 15 30-22-7Z" fill="#687984" stroke="#b0c5cf" />
        </>
      );
      break;
    case 'magic_missile':
      subject = (
        <>
          <path d="M22 120Q96 77 183 35L156 76Z" fill="#6c549e" />
          <path d="M41 109 176 46 155 67Z" fill="#c5b5eb" />
          <ellipse cx="178" cy="44" rx="19" ry="11" transform="rotate(-33 178 44)" fill="#f2ecff" />
          <path
            d="M22 91Q97 97 176 29M61 126Q149 99 196 53"
            fill="none"
            stroke={tone}
            strokeWidth="2"
          />
          <Rune x={50} y={111} rx={29} ry={11} />
        </>
      );
      break;
    case 'arcane_burst':
      subject = (
        <>
          <Rune y={83} rx={79} ry={33} />
          <path
            d="m120 16 10 46 77 17-75 13-12 39-11-39-77-13 77-17Z"
            fill="#795894"
            stroke="#d7c5ef"
          />
          <path d="m120 35 5 38 56 6-56 7-5 26-5-26-55-7 55-6Z" fill="#d8c8f3" />
          <circle cx="120" cy="79" r="10" fill="#fcf0ff" />
        </>
      );
      break;
    case 'arcane_surge':
      subject = (
        <>
          <Rune y={117} rx={75} ry={13} />
          {[0, 1, 2].map((i) => (
            <g
              key={i}
              transform={`translate(${56 + i * 48} ${36 - (i % 2) * 21}) rotate(${i * 12 - 12} 23 36)`}
            >
              <rect width="46" height="72" rx="4" fill="#24263f" stroke="#c5acdc" strokeWidth="2" />
              <path d="M5 8h36v56H5Z" fill="none" stroke="#8c729f" />
              <path d="m23 15 13 20-13 20-13-20Z" fill="#66547c" stroke="#e1cced" />
              <path d="M23 22v26" stroke="#fff0ff" />
            </g>
          ))}
        </>
      );
      break;
    case 'dispel':
      subject = (
        <>
          <Figure y={39} scale={0.82} />
          <path
            d="M62 108Q41 32 107 20M176 30Q212 92 151 117"
            fill="none"
            stroke="#b5e4d2"
            strokeWidth="4"
          />
          <path
            d="m104 14 10 5-8 8M149 110l-6 10 14 1"
            fill="none"
            stroke="#f2ffee"
            strokeWidth="2"
          />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <path key={i} d={`m${42 + i * 29} ${25 + (i % 2) * 75} 5-5 5 5-5 5Z`} fill="#c4e6d5" />
          ))}
          <Rune y={112} />
        </>
      );
      break;
    case 'execution':
      // Placeholder until the painted card (qa/warrior-store-set/REPORT.md CARD_ART_BRIEF):
      // a greatsword falling through a crimson verdict arc onto a rune-marked ground.
      subject = (
        <>
          <ellipse cx="120" cy="112" rx="56" ry="13" fill="none" stroke="#c9a35a" opacity=".7" />
          <path d="m84 112 8-5m56 5-8-5m-20 12v-8" stroke="#c9a35a" opacity=".7" />
          <path d="M52 34Q122 4 186 52" fill="none" stroke="#7a1a18" strokeWidth="12" />
          <path d="M52 34Q122 4 186 52" fill="none" stroke="#d8473b" strokeWidth="4" />
          <g transform="rotate(14 120 64)">
            <path d="M114 22h12l-1 70-5 14-5-14Z" fill="#9ba3ad" stroke="#e6ecf0" />
            <path d="M120 24v70" stroke="#5a6068" />
            <path d="M101 18h38l-4 7h-30Z" fill="#c9a35a" stroke="#f0d79a" />
            <path d="M116 0h8v18h-8Z" fill="#3a2a22" stroke="#c9a35a" />
            <path d="m120-8 6 6-6 6-6-6Z" fill="#d8473b" stroke="#f0d79a" />
          </g>
          <path d="M98 116q22-12 44 0" fill="none" stroke="#f0d79a" strokeWidth="2" />
        </>
      );
      break;
    default:
      subject = <Figure />;
  }
  return (
    <svg
      viewBox="0 0 240 140"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
      style={{ color: tone }}
    >
      <defs>
        <radialGradient id={id}>
          <stop stopColor={tone} stopOpacity=".28" />
          <stop offset="1" stopColor="#080f1a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="240" height="140" fill="#080f1a" />
      <path
        d="M0 128 24 104 51 112 73 97 108 112 146 96 177 114 213 97 240 112V140H0Z"
        fill="#162331"
      />
      <ellipse cx="127" cy="74" rx="116" ry="85" fill={`url(#${id})`} />
      {Array.from({ length: 17 }, (_, i) => (
        <circle
          key={i}
          cx={(i * 67 + 13) % 240}
          cy={(i * 31 + 7) % 130}
          r={i % 4 === 0 ? 1.4 : 0.65}
          fill={tone}
          opacity=".55"
        />
      ))}
      {subject}
      <path
        d="M8 25V8h24m176 0h24v17M8 115v17h24m176 0h24v-17"
        fill="none"
        stroke={tone}
        opacity=".35"
      />
    </svg>
  );
}
