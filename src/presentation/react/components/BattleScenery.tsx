import { ENVIRONMENT_PAINTINGS } from '../../assets/paintedAssets';
/** Decorative architecture behind the interactive Pixi scene; no gameplay geometry. */
export function BattleScenery({ theme = 'duel' }: { theme?: string }) {
  if (ENVIRONMENT_PAINTINGS[theme])
    return (
      <div
        className="painted-scenery"
        aria-hidden="true"
        style={{ backgroundImage: `url("${ENVIRONMENT_PAINTINGS[theme]}")` }}
      />
    );
  return (
    <svg
      className="battle-scenery"
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="scene-mist">
          <stop
            stopColor={
              theme === 'sanctuary' ? '#719cb4' : theme === 'fracture' ? '#62596d' : '#786c5b'
            }
            stopOpacity=".12"
          />
          <stop offset="1" stopColor="#080d17" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g opacity=".45" fill="#162431" stroke="#384957">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <path
            key={i}
            d={`M${230 + i * 180} 390V${160 + (i % 3) * 35}l25-37 25 37v${230 - (i % 3) * 35}Z`}
          />
        ))}
        <path d="M140 332Q800 156 1460 332M180 358Q800 196 1420 358" fill="none" strokeWidth="9" />
      </g>
      <ellipse cx="800" cy="380" rx="700" ry="230" fill="url(#scene-mist)" />
      {[false, true].map((mirror) => (
        <g key={String(mirror)} transform={mirror ? 'translate(1600 0) scale(-1 1)' : undefined}>
          <path
            d="M65 900V240Q100 81 255-35L280 0Q137 111 112 251V900Z"
            fill="#08101c"
            stroke="#3b4b55"
            strokeWidth="2"
          />
          <path
            d="M94 900V249Q133 100 260 0"
            fill="none"
            stroke="#7b8588"
            opacity=".25"
            strokeWidth="3"
          />
          <path
            d="M133 250h79v330h-79zm-13 330h107v27H120zm20-355h66v25h-66z"
            fill="#14222e"
            stroke="#43515a"
          />
          <path d="M146 268h12v289h-12zm37 0h12v289h-12z" fill="#070e17" />
          <path d="M133 605 79 676v79h165v-79l-32-71Z" fill="#101923" stroke="#35444e" />
          <path d="m151 638 26-23 17 37-28 26Z" fill="none" stroke="#9c8551" opacity=".6" />
          {theme === 'duel' ? (
            <g>
              <path d="M169 117h93v191l-25-15-20 30-21-24-27 12Z" fill="#3e2d31" stroke="#77624e" />
              <path d="M183 122v153m64-153v153" stroke="#ac9361" opacity=".6" />
              <path
                d="m215 155 17 29-17 29-17-29ZM215 164v40m-13-20h26"
                fill="none"
                stroke="#b19560"
                strokeWidth="2"
              />
            </g>
          ) : theme === 'sanctuary' ? (
            <g>
              <path d="m173 590-27-99 29-78 32 69-13 108Z" fill="#234252" stroke="#61869b" />
              <path d="m175 413-3 108 22 69 13-108Z" fill="#3d6c7e" />
              <path d="m174 445 7 64-9 42-8-41Z" fill="#78a9b7" opacity=".55" />
            </g>
          ) : (
            <g fill="#060b13" stroke="#4b4654">
              <path d="m128 379 74-49 9 46-37 16 17 24-56 30 13-39Z" />
              <path d="M86 685 185 651 217 687 143 717Z" />
              <path
                d="m167 461 21 22-17 29 16 19-10 38"
                fill="none"
                stroke="#a28a78"
                opacity=".4"
              />
            </g>
          )}
          <path
            d="M0 290Q70 378 140 361M0 308Q70 396 140 379"
            fill="none"
            stroke="#02060c"
            strokeWidth="9"
          />
          {Array.from({ length: 9 }, (_, i) => (
            <ellipse
              key={i}
              cx={i * 17}
              cy={307 + Math.sin(((i / 8) * Math.PI) / 2) * 62}
              rx="12"
              ry="5"
              fill="none"
              stroke="#45505b"
              strokeWidth="2"
              transform={`rotate(${40 - i * 6} ${i * 17} ${307 + Math.sin(((i / 8) * Math.PI) / 2) * 62})`}
            />
          ))}
          <ellipse
            cx="170"
            cy="532"
            rx="47"
            ry="76"
            fill={theme === 'sanctuary' ? '#80d9f2' : '#db792d'}
            opacity=".05"
          />
          <path d="m145 543 51 0-11 14h-28Z" fill="#6b563c" stroke="#a58b60" />
          <path
            d="M154 541Q139 521 161 502Q153 520 174 483Q195 522 184 540Z"
            fill={theme === 'sanctuary' ? '#387b9b' : theme === 'fracture' ? '#70617c' : '#a9602e'}
            opacity=".8"
          />
          <path
            d="M165 541Q158 528 174 506Q185 529 177 542Z"
            fill={theme === 'sanctuary' ? '#a3dfef' : theme === 'fracture' ? '#bab0bf' : '#f5c26a'}
          />
        </g>
      ))}
      <path
        d="M290 80Q800-130 1310 80M315 93Q800-96 1285 93"
        fill="none"
        stroke="#647476"
        opacity=".14"
      />
    </svg>
  );
}
