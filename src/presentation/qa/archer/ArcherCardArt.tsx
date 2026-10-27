import { useId, type ReactNode } from 'react';

/**
 * Archer card illustrations (9 cards). Stylized vector art in the project's SVG card-art system:
 * one hunter palette (forest green, leather, mystic violet, gold) and a distinct subject per card
 * that shows what the card DOES. Decorative only. A painterly raster pass can replace any entry
 * by registering FINAL_CARD_ART[cardId] (see qa/archer-gameplay-visual/ART_PROMPTS.md).
 */
export const ARCHER_CARD_ART_IDS = [
  'archer_shot', 'hunters_eye', 'true_shot', 'stalker_step', 'piercing_arrow',
  'heart_shot', 'tactical_retreat', 'bramble_trap', 'executioner_arrow',
] as const;
export const hasArcherCardArt = (cardId: string | undefined): boolean =>
  !!cardId && (ARCHER_CARD_ART_IDS as readonly string[]).includes(cardId);

const C = {
  night: '#0b130f', canopy: '#16241a', moss: '#2f4a2c', leaf: '#5f8f4a', fern: '#9fbf6a',
  leather: '#6b4a2b', hide: '#a77c4b', bone: '#e6dcc4', steel: '#d8d2c2',
  violet: '#8e6bd1', violetLight: '#c8a6ff', glow: '#eadbff', gold: '#e2c27a', blood: '#9b3b3b',
} as const;

/** A wooden arrow along the x axis from (0,0) to (len,0): fletching, shaft, steel head. */
function Arrow({ x, y, len = 70, angle = 0, head = 'leaf', fletch = C.violet }: {
  x: number; y: number; len?: number; angle?: number; head?: 'leaf' | 'broad' | 'crescent'; fletch?: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <path d={`M2 0 -6 -6 6 -1ZM2 0 -6 6 6 1Z`} fill={fletch} stroke={C.glow} strokeWidth=".6" />
      <path d={`M10 0-4-5M10 0-4 5`} stroke={fletch} strokeWidth="1.4" />
      <path d={`M0 0H${len}`} stroke={C.hide} strokeWidth="2.4" strokeLinecap="round" />
      {head === 'leaf' && <path d={`M${len - 2} -4 ${len + 11} 0 ${len - 2} 4Z`} fill={C.steel} stroke="#fff" strokeWidth=".6" />}
      {head === 'broad' && <path d={`M${len - 4} -7 ${len + 14} 0 ${len - 4} 7 ${len} 0Z`} fill={C.steel} stroke="#fff" strokeWidth=".7" />}
      {head === 'crescent' && (
        <path d={`M${len - 4} -11Q${len + 18} 0 ${len - 4} 11Q${len + 6} 0 ${len - 4} -11Z`} fill="#b9b3a8" stroke={C.blood} strokeWidth="1.2" />
      )}
    </g>
  );
}

/** Hooded hunter in three-quarter view, drawing (or holding) a longbow. */
function Hunter({ x, y, s = 1, draw = true, flip = false }: { x: number; y: number; s?: number; draw?: boolean; flip?: boolean }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      <path d="M-16 4Q-28 40-24 70L-6 64 4 72 18 66Q14 34 8 4Z" fill={C.moss} stroke="#4c6e44" />
      <path d="M-12 6-10 28 6 30 8 6Z" fill={C.leather} />
      <path d="M-14 8Q-16-14 0-20Q16-14 12 8Q0 2-14 8Z" fill="#24391f" stroke="#58804a" />
      <path d="M-7 0Q0-9 7 0Q0 4-7 0Z" fill="#0a100b" />
      <path d="M-3-1h2m3 0h2" stroke={C.violetLight} strokeWidth="1.2" />
      <path d="M6 12 34 6" stroke={C.leather} strokeWidth="5" strokeLinecap="round" />
      <path d={draw ? 'M40-30Q58 6 40 42' : 'M34-28Q50 6 34 40'} fill="none" stroke="#7a532d" strokeWidth="3.6" strokeLinecap="round" />
      <path d={draw ? 'M40-30 10 8 40 42' : 'M34-28V40'} fill="none" stroke={C.bone} strokeWidth=".9" />
      <path d="M-14 22-22 30M-10 64-12 78M8 64l3 14" stroke="#3c2a1a" strokeWidth="3" strokeLinecap="round" />
      <path d="M-20 6Q-30 10-26 22" fill="none" stroke={C.violet} strokeWidth="1.2" opacity=".7" />
    </g>
  );
}

function Forest({ id }: { id: string }) {
  return (
    <g>
      <rect width="240" height="140" fill={`url(#${id}-sky)`} />
      {[8, 34, 60, 172, 198, 226].map((x, i) => (
        <path key={x} d={`M${x} ${118 - (i % 3) * 6}l12-${56 + (i % 2) * 14} 12 ${56 + (i % 2) * 14}Z`} fill={C.canopy} opacity={0.75 - (i % 3) * 0.12} />
      ))}
      <path d="M0 120Q60 108 120 116T240 112V140H0Z" fill="#101b12" />
      <path d="M0 128Q70 120 130 127T240 124V140H0Z" fill="#0a120c" />
    </g>
  );
}
function Reticle({ x, y, r, color = C.violetLight, width = 1.6 }: { x: number; y: number; r: number; color?: string; width?: number }) {
  return (
    <g fill="none" stroke={color} strokeWidth={width}>
      {[0, 90, 180, 270].map((a) => (
        <path key={a} transform={`rotate(${a} ${x} ${y})`} d={`M${x + r * 0.39} ${y - r * 0.92}A${r} ${r} 0 0 1 ${x + r * 0.92} ${y - r * 0.39}`} />
      ))}
      <path d={`M${x} ${y - r - 6}v9M${x} ${y + r - 3}v9M${x - r - 6} ${y}h9M${x + r - 3} ${y}h9`} stroke={C.gold} />
    </g>
  );
}
const Leaves = ({ pts }: { pts: [number, number, number][] }) => (
  <g>
    {pts.map(([x, y, a], i) => (
      <path key={i} transform={`translate(${x} ${y}) rotate(${a})`} d="M0 0Q5-4 10 0Q5 4 0 0Z" fill={i % 2 ? C.leaf : C.fern} opacity=".85" />
    ))}
  </g>
);

const SUBJECTS: Record<(typeof ARCHER_CARD_ART_IDS)[number], (id: string) => ReactNode> = {
  // Basic, honest shot: a hunter, a bow, one arrow, a straw target. Marked BÁSICO.
  archer_shot: () => (
    <>
      <Hunter x={62} y={58} s={0.95} />
      <path d="M118 66Q150 60 176 64" stroke={C.bone} strokeWidth=".8" strokeDasharray="3 5" opacity=".6" />
      <Arrow x={122} y={64} len={46} angle={-2} fletch={C.leaf} />
      <g transform="translate(196 70)">
        <ellipse rx="20" ry="26" fill="#8a6a3e" stroke="#c9a86a" />
        <ellipse rx="13" ry="17" fill="none" stroke="#5b4124" strokeWidth="3" />
        <ellipse rx="5" ry="7" fill="#5b4124" />
        <path d="M-6 26-10 46M6 26l4 20" stroke="#5b4124" strokeWidth="3" />
      </g>
      <g transform="translate(14 112)">
        <path d="M0 0h52l-6 8 6 8H0Z" fill="#3a2a1a" stroke={C.gold} strokeWidth=".8" />
        <text x="24" y="11.5" textAnchor="middle" fontSize="9" fontWeight="700" fill={C.bone} letterSpacing="1">BÁSICO</text>
      </g>
    </>
  ),
  // The mark: a hunter's eye opens inside a rune reticle among dark trees.
  hunters_eye: (id) => (
    <>
      <circle cx="120" cy="68" r="52" fill={`url(#${id}-violet)`} />
      <Reticle x={120} y={68} r={40} />
      <path d="M72 68Q120 26 168 68Q120 110 72 68Z" fill="#170f24" stroke={C.violetLight} strokeWidth="2" />
      <circle cx="120" cy="68" r="17" fill={C.violet} stroke={C.glow} strokeWidth="1.2" />
      <path d="M120 54Q114 68 120 82Q126 68 120 54Z" fill="#0b0712" />
      <circle cx="114" cy="62" r="3" fill={C.glow} opacity=".9" />
      {[-60, -30, 0, 30, 60].map((a) => (
        <path key={a} transform={`rotate(${a} 120 68)`} d="M120 18v-8" stroke={C.gold} strokeWidth="1.4" opacity=".7" />
      ))}
    </>
  ),
  // Precision: a dotted arc lands dead-centre in a wooden target under a violet reticle.
  true_shot: () => (
    <>
      <path d="M22 108Q90 18 160 62" fill="none" stroke={C.violetLight} strokeWidth="1.2" strokeDasharray="2 6" />
      <g transform="translate(170 70)">
        <circle r="34" fill="#6d4f2c" stroke="#c9a86a" strokeWidth="1.5" />
        <circle r="24" fill="none" stroke="#e6d3a3" strokeWidth="4" />
        <circle r="13" fill="#8e2f2f" stroke="#e6d3a3" strokeWidth="2" />
        <circle r="4" fill={C.gold} />
      </g>
      <Reticle x={170} y={70} r={46} />
      <Arrow x={110} y={88} len={54} angle={-19} />
      <path d="M170 70l10-12M170 70l13 3M170 70l4 13" stroke={C.gold} strokeWidth="1.6" />
    </>
  ),
  // Stalking: a crouched hunter in tall grass; faint violet footprints show the path taken.
  stalker_step: () => (
    <>
      {[30, 62, 94].map((x, i) => (
        <g key={x} transform={`translate(${x} ${116 - i * 4})`} opacity={0.35 + i * 0.2}>
          <ellipse rx="5" ry="3" fill={C.violet} />
          <ellipse cx="12" cy="-6" rx="5" ry="3" fill={C.violet} />
        </g>
      ))}
      <g transform="translate(150 70) rotate(8)">
        <path d="M-30 20Q-20-12 6-18Q30-12 34 18Q10 40-30 20Z" fill={C.moss} stroke="#58804a" />
        <path d="M-6-18Q-8-36 6-38Q20-34 18-16Z" fill="#24391f" stroke="#58804a" />
        <path d="M2-26h3m4 0h3" stroke={C.violetLight} strokeWidth="1.4" />
        <path d="M30 0Q46 18 30 40" fill="none" stroke="#7a532d" strokeWidth="3" />
      </g>
      {Array.from({ length: 22 }, (_, i) => (
        <path key={i} d={`M${100 + i * 6} 128q${(i % 3) - 1} -${18 + (i % 4) * 7} ${4 - (i % 3) * 3} -${28 + (i % 5) * 6}`} stroke={i % 2 ? C.leaf : C.moss} strokeWidth="2" fill="none" />
      ))}
      <Leaves pts={[[60, 50, 20], [84, 36, -30], [112, 28, 50], [42, 70, -10]]} />
    </>
  ),
  // Through-and-through: one arrow trailing violet passes two foes in a line.
  piercing_arrow: () => (
    <>
      {[[110, 78], [178, 74]].map(([x, y], i) => (
        <g key={x} transform={`translate(${x} ${y})`}>
          <path d="M-20 48Q-24 4-12-10H12Q24 4 20 48Z" fill={i ? '#3a2422' : '#2d2a2a'} stroke="#6b5552" />
          <path d="M-12-10Q-14-30 0-34Q14-30 12-10Z" fill="#4a3330" stroke="#6b5552" />
          <path d="M-6-22h4m4 0h4" stroke="#e08a86" strokeWidth="1.6" />
          <path d="M-14 0l28 0" stroke={C.violetLight} strokeWidth="1.2" opacity=".8" />
        </g>
      ))}
      <path d="M14 82Q120 74 214 70" stroke={C.violet} strokeWidth="6" opacity=".35" />
      <path d="M14 82Q120 74 214 70" stroke={C.violetLight} strokeWidth="1.4" />
      <Arrow x={168} y={71} len={44} angle={-1.4} head="broad" />
      {[110, 178].map((x) => (
        <g key={x} stroke={C.glow} strokeWidth="1.4">
          <path d={`M${x - 8} ${74}l-10-8M${x - 8} 78l-12 2M${x - 8} 82l-9 9`} />
        </g>
      ))}
    </>
  ),
  // Signature finisher: a violet heart-rune split by a broad arrow; three focus arrowheads lit.
  heart_shot: (id) => (
    <>
      <circle cx="120" cy="64" r="58" fill={`url(#${id}-violet)`} />
      <path d="M120 112C70 82 62 52 80 36C94 24 112 30 120 44C128 30 146 24 160 36C178 52 170 82 120 112Z" fill="#2a1840" stroke={C.violetLight} strokeWidth="2.4" />
      <path d="M120 98C86 76 80 56 92 46C102 38 114 44 120 54C126 44 138 38 148 46C160 56 154 76 120 98Z" fill={C.violet} opacity=".55" />
      <Reticle x={120} y={64} r={30} color={C.glow} width={1.2} />
      <Arrow x={22} y={92} len={170} angle={-14} head="broad" />
      {[96, 120, 144].map((x) => (
        <path key={x} d={`M${x} 118l7 12-7-4-7 4Z`} fill={C.violetLight} stroke={C.gold} strokeWidth="1.2" />
      ))}
      {Array.from({ length: 8 }, (_, i) => (
        <path key={i} transform={`rotate(${i * 45} 120 64)`} d="M120 8v8" stroke={C.gold} strokeWidth="1.4" opacity=".75" />
      ))}
    </>
  ),
  // Retreat: the hunter vaults back in an arc, away from raking claw marks, bow still ready.
  tactical_retreat: () => (
    <>
      <path d="M196 96Q150 18 70 54" fill="none" stroke={C.leaf} strokeWidth="1.6" strokeDasharray="5 5" />
      <path d="M74 50l-10 6 12 3" fill="none" stroke={C.leaf} strokeWidth="1.6" />
      <Hunter x={78} y={40} s={0.8} draw={false} flip />
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M${190 + i * 12} ${46 + i * 2}q14 26 4 56`} fill="none" stroke="#c96a5e" strokeWidth={4 - i} strokeLinecap="round" opacity=".85" />
      ))}
      <Leaves pts={[[128, 30, 10], [150, 46, -40], [110, 80, 30], [170, 26, 60], [96, 98, -20]]} />
      <ellipse cx="80" cy="120" rx="34" ry="6" fill="#000" opacity=".35" />
    </>
  ),
  // The snare: a thorn ring on the forest floor, roots springing up to close on the intruder.
  bramble_trap: () => (
    <>
      <ellipse cx="120" cy="104" rx="78" ry="22" fill="#14200f" stroke={C.leather} strokeWidth="3" />
      <ellipse cx="120" cy="104" rx="58" ry="15" fill="none" stroke={C.leaf} strokeWidth="2" />
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2, x = 120 + Math.cos(a) * 70, y = 104 + Math.sin(a) * 19;
        return <path key={i} d={`M${x} ${y}l${Math.cos(a + 0.6) * 9} ${-6 - (i % 3) * 3}`} stroke={C.fern} strokeWidth="2" />;
      })}
      {([[84, 1], [104, -1], [138, 1], [158, -1]] as const).map(([x, d], i) => (
        <path key={i} d={`M${x} 104Q${x + d * 18} ${70 - i * 4} ${120 + (x - 120) * 0.25} ${34 + (i % 2) * 6}`} fill="none" stroke={i % 2 ? C.leather : C.moss} strokeWidth={5 - (i % 2)} strokeLinecap="round" />
      ))}
      {[[96, 80], [146, 74], [110, 56], [132, 50]].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y}l6-3-2 6Z`} fill={C.fern} />
      ))}
      <circle cx="120" cy="104" r="5" fill={C.violetLight} />
      <circle cx="120" cy="104" r="11" fill="none" stroke={C.violet} opacity=".7" />
    </>
  ),
  // The executioner's arrow: a crescent head over a wounded foe's failing life (≤40%).
  executioner_arrow: () => (
    <>
      <g transform="translate(170 64)">
        <path d="M-24 52Q-30 8-16-6H16Q30 8 24 52Z" fill="#2f2324" stroke="#6b5552" />
        <path d="M-15-6Q-17-30 0-34Q17-30 15-6Z" fill="#4a3330" stroke="#6b5552" />
        <path d="M-7-20h5m5 0h5" stroke="#e08a86" strokeWidth="1.6" />
        <path d="M-6 10l4 10-6 8 5 12" fill="none" stroke={C.blood} strokeWidth="2" />
      </g>
      <g transform="translate(130 18)">
        <rect width="80" height="8" rx="2" fill="#1a1012" stroke="#6b5552" />
        <rect x="1" y="1" width="30" height="6" rx="1.5" fill={C.blood} />
        <path d="M32-3v14" stroke={C.gold} strokeWidth="1.4" />
        <text x="36" y="-4" fontSize="8" fill={C.gold} fontWeight="700">40%</text>
      </g>
      <Arrow x={18} y={86} len={112} angle={-8} head="crescent" fletch="#5a3d74" />
      <path d="M18 92Q80 84 138 76" stroke={C.violet} strokeWidth="4" opacity=".25" />
      <Reticle x={170} y={70} r={30} color={C.violetLight} width={1.2} />
    </>
  ),
};

export function ArcherCardArt({ cardId }: { cardId: string }) {
  const id = `archer-${useId().replace(/:/g, '')}`;
  const subject = SUBJECTS[cardId as (typeof ARCHER_CARD_ART_IDS)[number]];
  if (!subject) return null;
  return (
    <svg viewBox="0 0 240 140" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" focusable="false" data-archer-art={cardId} className="archer-card-art">
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0e1a15" />
          <stop offset=".65" stopColor="#1a2a1e" />
          <stop offset="1" stopColor={C.night} />
        </linearGradient>
        <radialGradient id={`${id}-violet`}>
          <stop offset="0" stopColor={C.violet} stopOpacity=".55" />
          <stop offset="1" stopColor={C.violet} stopOpacity="0" />
        </radialGradient>
      </defs>
      <Forest id={id} />
      {subject(id)}
      <path d="M8 25V8h24m176 0h24v17M8 115v17h24m176 0h24v-17" fill="none" stroke={C.gold} opacity=".35" />
    </svg>
  );
}
