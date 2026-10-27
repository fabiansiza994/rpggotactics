import { describe, expect, it } from 'vitest';
import { createResultHistory, resultDuration } from '../src/presentation/results/resultPresentationState';
describe('cosmetic result history', () => {
 it('uses stable match keys across restored snapshots', () => {const h=createResultHistory();h.mark('match-a');expect(h.has('match-a')).toBe(true);expect(h.has('match-b')).toBe(false);});
 it('does not suppress another PvE engine', () => {const h=createResultHistory();const a={},b={};h.mark(a);expect(h.has(a)).toBe(true);expect(h.has(b)).toBe(false);});
 it('bounds retained match identifiers', () => {const h=createResultHistory();for(let i=0;i<129;i++)h.mark(String(i));expect(h.has('0')).toBe(false);expect(h.has('128')).toBe(true);});
 it('keeps draw concise and victory/defeat at 2.4 seconds', () => {expect(resultDuration('draw')).toBe(1200);expect(resultDuration('victory')).toBe(2400);expect(resultDuration('defeat')).toBe(2400);});
});
