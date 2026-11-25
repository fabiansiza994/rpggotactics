import { describe, it, expect } from 'vitest';
import { maintenanceGate, maintenanceState, cancelWaitingAdmission } from '../server/src/maintenance';
import { contentTransition } from '../server/src/contentTransition';
import { handle } from '../server/src/index';
import type { Env } from '../server/src/db';
import { CONTENT_RELEASE } from '../src/game/pvp/content-release';
import { parseAvailability } from '../src/presentation/maintenance/PremiumMaintenance';
const env = (maintenance = '0', drain = '0') => ({ RELEASE2_MAINTENANCE: maintenance, CONTENT_RELEASE_DRAIN: drain } as Env);
const req = (path: string, method = 'POST') => new Request('https://local.test/api/tactics/' + path, { method });
describe('Existing maintenance and drainage flags', () => {
  it.each(['ranked/queue', 'ranked/bot', 'pvp/create', 'pvp/join', 'pvp/ready', 'pvp/rematch', 'campaign/start', 'skirmish/start', 'champions/start'])('blocks new %s with both existing gates', path => {
    for (const flags of [env('1'), env('0','1')]) expect(maintenanceGate(req(path), flags)?.status).toBe(503);
    expect(maintenanceGate(req(path), env())).toBeNull();
  });
  it.each(['store/paypal/live/orders','store/paypal/orders','store/real-money/checkout','store/purchase','store/box/reset','ranked/premium/purchase'])('maintenance closes new purchase %s, drainage keeps it available', path => {
    expect(maintenanceGate(req(path), env('1'))?.status).toBe(503);
    expect(maintenanceGate(req(path), env('0','1'))).toBeNull();
  });
  it.each(['store/paypal/live/orders/ABC/capture','store/paypal/live/orders/ABC/recover','store/paypal/live/webhook','campaign/victory','campaign/reward','skirmish/victory','skirmish/reward','pvp/connect','pvp/leave','ranked/cancel'])('preserves existing operation %s', path => {
    expect(maintenanceGate(req(path), env('1','1'))).toBeNull();
  });
  it.each(['pvp/state','pvp/active','state','store/paypal/live/orders','store/paypal/live/catalog','wallet'])('preserves read-only %s', path => expect(maintenanceGate(req(path,'GET'),env('1','1'))).toBeNull());
  it('does not let QA allowlisting or old client parameters bypass new admissions', () => {
    const flags={...env('1'),RELEASE2_QA_USERS:'qa',RELEASE2_CLIENT_REQUIRED:'1'} as Env;
    expect(contentTransition(req('pvp/create?clientRelease=obsolete'),flags,'qa')?.status).toBe(503);
    expect(contentTransition(req('pvp/create?clientRelease='+CONTENT_RELEASE),flags,'qa')?.status).toBe(503);
  });
  it('keeps version gates when open and reopens without altering flags', () => {
    const flags={...env(),RELEASE2_CLIENT_REQUIRED:'1'} as Env;
    expect(contentTransition(req('pvp/create?clientRelease=obsolete'),flags)?.status).toBe(426);
    expect(contentTransition(req('pvp/create?clientRelease='+CONTENT_RELEASE),flags)).toBeNull();
    expect(maintenanceState(env())).toEqual({phase:'OPEN',admissionsBlocked:false,purchasesBlocked:false});
  });
  it('publishes minimal no-cache state without DB or credential access', async () => {
    const response=await handle(req('availability','GET'),env('1'));
    expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual({phase:'MAINTENANCE',admissionsBlocked:true,purchasesBlocked:true});
  });
  it('rejects unrecognized or internally inconsistent reopening data', () => {
    expect(parseAvailability({phase:'OPEN',admissionsBlocked:true,purchasesBlocked:false})).toBeNull();
    expect(parseAvailability({phase:'OPEN',admissionsBlocked:false,purchasesBlocked:false})).not.toBeNull();
    expect(parseAvailability({phase:'UNKNOWN'})).toBeNull();
  });
});

it('cancels only the caller unassigned queue ticket during closure', async () => {
  const seen: unknown[] = []; const flags={...env('1'),DB:{prepare:(sql:string)=>{seen.push(sql);return{bind:(id:number)=>{seen.push(id);return{run:async()=>({success:true})};}};}}} as unknown as Env;
  await cancelWaitingAdmission(req('ranked/queue','GET'),flags,42);
  expect(seen).toEqual(['DELETE FROM tactics_ranked_queue WHERE user_id = ? AND room_code IS NULL',42]);
  seen.length=0; await cancelWaitingAdmission(req('pvp/connect'),flags,42); expect(seen).toEqual([]);
  await cancelWaitingAdmission(req('ranked/queue'),{...flags,RELEASE2_MAINTENANCE:'0'},42);expect(seen).toEqual([]);
});
