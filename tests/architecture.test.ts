import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const GAME_DIR = fileURLToPath(new URL('../src/game', import.meta.url));

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

const FORBIDDEN = [/from ['"]react/, /from ['"]pixi/, /from ['"]zustand/, /presentation\//, /\bdocument\./, /\bwindow\./];

describe('architecture boundaries', () => {
  it('the game core (domain/engine/data) never depends on React, Pixi, zustand, DOM or presentation', () => {
    const offenders: string[] = [];
    for (const file of listFiles(GAME_DIR).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(file, 'utf8');
      for (const rule of FORBIDDEN) {
        if (rule.test(source)) offenders.push(`${relative(GAME_DIR, file)} matches ${rule}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the game core has no randomness or time outside the seeded RNG (determinism)', () => {
    const offenders = listFiles(GAME_DIR)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /Math\.random|Date\.now|new Date\(|performance\.now|setTimeout|setInterval/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the domain never reads card presentation hints', () => {
    const domainFiles = listFiles(join(GAME_DIR, 'domain')).filter((f) => f.endsWith('.ts'));
    const offenders = domainFiles.filter((f) => /\.presentation\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no card-specific branching in the rules (cards are data-driven)', () => {
    const domainFiles = listFiles(join(GAME_DIR, 'domain')).filter((f) => f.endsWith('.ts'));
    const offenders = domainFiles.filter((f) => /cardId\s*===|\.id\s*===\s*['"](fireball|blink|ice_wall|barrier)/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
