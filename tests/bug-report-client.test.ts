import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeBugContext } from '../src/game/support/bugReport';
import type { CloudResult } from '../src/presentation/cloud/http';
import type { BugReportBody, BugReportResponse } from '../src/presentation/support/api';
import { createReportSubmitter, REPORT_FAILED, REPORT_RATE_LIMITED, REPORT_SESSION_EXPIRED } from '../src/presentation/support/submit';

const draft = { category: 'BATTLE' as const, description: 'Algo raro pasó en la batalla.', reproductionSteps: null, context: {} };
const ok = (reportId: string): CloudResult<BugReportResponse> => ({ ok: true, data: { success: true, reportId } });
const fail = (kind: 'NETWORK' | 'AUTH' | 'REJECTED' | 'SERVER', status: number, code: string, message = 'raw: TypeError at line 42'): CloudResult<BugReportResponse> => ({
  ok: false,
  error: { kind, status, code, message },
});

describe('report submitter (duplicate submit protection)', () => {
  it('a second submit while one is in flight sends nothing and reports BUSY', async () => {
    let release!: (r: CloudResult<BugReportResponse>) => void;
    const send = vi.fn<(body: BugReportBody) => Promise<CloudResult<BugReportResponse>>>(() => new Promise((r) => (release = r)));
    const submitter = createReportSubmitter(send);
    const first = submitter.submit(draft);
    expect(submitter.busy).toBe(true);
    expect(await submitter.submit(draft)).toEqual({ status: 'BUSY' });
    expect(await submitter.submit(draft)).toEqual({ status: 'BUSY' });
    release(ok('bug_1'));
    expect(await first).toEqual({ status: 'SENT', reportId: 'bug_1' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(submitter.busy).toBe(false);
  });

  it('a retry after a failure reuses the client id; a new report after success gets a new one', async () => {
    const results = [fail('NETWORK', 0, 'NETWORK'), ok('bug_1'), ok('bug_2')];
    const send = vi.fn<(body: BugReportBody) => Promise<CloudResult<BugReportResponse>>>(async () => results.shift()!);
    const submitter = createReportSubmitter(send);
    expect(await submitter.submit(draft)).toEqual({ status: 'FAILED', message: REPORT_FAILED, auth: false });
    await submitter.submit(draft);
    await submitter.submit(draft);
    const ids = send.mock.calls.map(([body]) => body.clientReportId);
    expect(ids[0]).toMatch(/^rep_[A-Za-z0-9_-]{8,}$/);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('never shows raw errors: generic, rate-limit, session and own validation messages only', async () => {
    const run = (r: CloudResult<BugReportResponse>) => createReportSubmitter(async () => r).submit(draft);
    expect(await run(fail('SERVER', 500, 'SERVER_ERROR'))).toMatchObject({ message: REPORT_FAILED });
    expect(await run(fail('TIMEOUT' as 'NETWORK', 0, 'TIMEOUT'))).toMatchObject({ message: REPORT_FAILED });
    expect(await run(fail('REJECTED', 429, 'RATE_LIMITED'))).toMatchObject({ message: REPORT_RATE_LIMITED });
    expect(await run(fail('AUTH', 401, 'UNAUTHENTICATED'))).toMatchObject({ message: REPORT_SESSION_EXPIRED, auth: true });
    expect(await run(fail('REJECTED', 400, 'HTML_NOT_ALLOWED'))).toMatchObject({ message: expect.stringContaining('texto simple') });
    expect(await run(fail('REJECTED', 400, 'SOMETHING_ELSE'))).toMatchObject({ message: REPORT_FAILED });
    expect(await createReportSubmitter(() => Promise.reject(new Error('boom'))).submit(draft)).toMatchObject({ message: REPORT_FAILED });
  });
});

describe('automatic context', () => {
  const memory = new Map<string, string>();
  beforeEach(() => {
    memory.clear();
    vi.stubGlobal('window', {
      localStorage: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v), removeItem: (k: string) => void memory.delete(k) },
      innerWidth: 1280,
      innerHeight: 720,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  async function boot() {
    vi.resetModules();
    const { useBattleStore } = await import('../src/presentation/store/battleStore');
    const ctx = await import('../src/presentation/support/reportContext');
    return { useBattleStore, ...ctx };
  }

  it('captures campaign battle ids, champion, round and phase — not the hand or the deck order', async () => {
    const { useBattleStore, collectReportContext } = await boot();
    expect(await useBattleStore.getState().startRun(11)).toBe(true);
    const s = useBattleStore.getState();
    const ctx = collectReportContext('BATTLE');
    expect(ctx).toMatchObject({
      route: 'BATTLE',
      screen: 'CAMPAIGN_BATTLE',
      heroId: s.run!.heroId,
      campaignId: s.run!.campaignId,
      encounterId: s.run!.currentEncounterId,
      runId: `${s.run!.campaignId}:${s.run!.heroId}:11`,
      battleId: `${s.run!.campaignId}:${s.run!.heroId}:11:${s.run!.currentEncounterId}`,
      worldId: s.campaignWorldId,
      round: s.state!.round,
      phase: s.state!.phase,
      viewport: '1280x720',
    });
    const text = JSON.stringify(ctx);
    for (const card of s.state!.player.hand) expect(text).not.toContain(card.uid);
    expect(text).not.toMatch(/hand|deck"|token/i);
    // What the client collects survives the server whitelist unchanged.
    expect(sanitizeBugContext(JSON.parse(text))).toEqual(JSON.parse(text));
  });

  it('captures the PvP room, mode, own champion and round — and nothing about the rival', async () => {
    const { useBattleStore, collectReportContext, setPvpReportContext } = await boot();
    await useBattleStore.getState().startRun(11);
    const state = useBattleStore.getState().state!;
    useBattleStore.setState({ state: { ...state, round: 4, duel: { champions: ['warrior', 'mage'], active: 0, other: state.player, turns: 7 } } });
    setPvpReportContext({ roomCode: 'ABCD2345', mode: 'DOMINION', heroId: 'warrior', inMatch: true });
    const ctx = collectReportContext('PVP');
    expect(ctx).toMatchObject({ route: 'PVP', screen: 'PVP_MATCH', matchId: 'ABCD2345', pvpMode: 'DOMINION', heroId: 'warrior', round: 4, turn: 7 });
    expect(ctx).not.toHaveProperty('encounterId');
    expect(JSON.stringify(ctx)).not.toMatch(/mage|other|hand/);
    setPvpReportContext(null);
    expect(collectReportContext('PVP')).not.toHaveProperty('matchId');
  });

  it('outside battle: screen, selected champion and deck', async () => {
    const { useBattleStore, collectReportContext } = await boot();
    const s = useBattleStore.getState();
    expect(collectReportContext('STORE')).toMatchObject({ route: 'STORE', screen: 'STORE', heroId: s.profile.selectedChampionId });
    expect(collectReportContext('MENU')).toMatchObject({ screen: 'HOME', worldId: s.campaignWorldId });
  });
});
