import { VERTICAL_ASSETS } from '../src/presentation/qa/locomotion/directionalProfiles';
import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { DEFAULT_CONTENT } from '../src/game';
import {
  CHARACTER_ANIMATIONS,
  QA_FORM_ANIMATIONS,
  QA_SUMMONER_ANIMATIONS,
} from '../src/presentation/pixi/characterAnimations';
import { unitVisualId } from '../src/presentation/assets/visualIdentity';
import { locomotionClip } from '../src/presentation/pixi/locomotion';
it('audits actual registered locomotion capabilities, without labeling procedural movement as sprites', () => {
  const units = [
    ...Object.values(DEFAULT_CONTENT.heroes),
    ...Object.values(DEFAULT_CONTENT.enemies),
    ...Object.values(DEFAULT_CONTENT.summons ?? {}),
    ...['humanoid', 'bear', 'minotaur'].map((id) => ({
      id: `qa_form_${id}`,
      name: `Cambiaformas ${id}`,
    })),
  ];
  const rows = units.map((u) => {
    const visual = unitVisualId(u.id),
      a =
        CHARACTER_ANIMATIONS[visual] ??
        QA_FORM_ANIMATIONS[visual] ??
        QA_SUMMONER_ANIMATIONS[visual];
    const idle = a?.clips.idle?.count ?? 0,
      walk = a?.clips.walk?.count ?? a?.clips.walk_heavy?.count ?? 0,
      run = a?.clips.run?.count ?? 0;
    return {
      id: u.id,
      name: u.name,
      visual,
      idle,
      walk,
      run,
      verticalWalk: VERTICAL_ASSETS[visual] ? 3 : a?.directionalUrls ? walk : 0,
      verticalRun: VERTICAL_ASSETS[visual] ? 3 : a?.directionalUrls ? run || walk : 0,
      directions: VERTICAL_ASSETS[visual]
        ? 'front, back nuevos; left/right heredados'
        : a?.directionalUrls
          ? Object.keys(a.directionalUrls).join(', ')
          : visual === 'mage'
            ? '4 poses estáticas; atlas único'
            : 'perfil + espejo',
      missing:
        [
          !walk && !run ? 'caminar lateral' : null,
          !run ? 'run lateral propio (reutiliza gait con cadencia rápida QA)' : null,
        ]
          .filter(Boolean)
          .join(', ') || '—',
      sliding: !locomotionClip(a, 'walk') && !locomotionClip(a, 'run'),
    };
  });
  expect(rows.length).toBeGreaterThan(20);
  const lines = [
    '# Matriz de locomoción real',
    '',
    'Contado desde los registros usados por Pixi, no desde nombres de archivos. Un frame no es un ciclo. Las criaturas sin atlas conservan poses/procedimiento existentes; eso NO constituye caminar/correr multifotograma. Las direcciones espejo no son cuatro vistas dibujadas. Front/back nuevos son ilustraciones independientes. Los laterales existentes se conservan; si no existe run propio se reutiliza su gait a cadencia rápida exclusivamente en QA.',
    '',
    '| Personaje | Visual | Idle frames | Walk / vuelo lento frames | Run / vuelo rápido frames | Direcciones | Walk ↑↓ | Run ↑↓ | Falta | Desliza sin ciclo |',
    '|---|---|---:|---:|---:|---|---:|---:|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.name} (${r.id}) | ${r.visual} | ${r.idle || 'pose/procedural'} | ${r.walk} | ${r.run} | ${r.directions} | ${r.verticalWalk} | ${r.verticalRun} | ${r.missing} | ${r.sliding ? 'Sí' : 'No; usa gait existente como fallback si falta uno'} |`,
    ),
  ];
  writeFileSync('qa/combat-depth/ANIMATION_MATRIX.md', lines.join('\n') + '\n');
  writeFileSync('qa/combat-depth/animation-matrix.json', JSON.stringify(rows, null, 2) + '\n');
});

it('has bounded original form atlases with distinct authored walk/run frames, kept out of public registrations', async () => {
  const { statSync, readFileSync } = await import('node:fs');
  for (const [id, layout] of Object.entries(QA_FORM_ANIMATIONS)) {
    expect(layout.clips.walk!.count).toBeGreaterThan(1);
    expect(layout.clips.run!.count).toBeGreaterThan(1);
    expect(layout.clips.walk!.start).not.toBe(layout.clips.run!.start);
    const path = `public${layout.url}`,
      bytes = readFileSync(path);
    expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
    expect(statSync(path).size).toBeLessThan(220000);
    expect(CHARACTER_ANIMATIONS[id]).toBeUndefined(); // test/public mode never loads private atlases
  }
});
