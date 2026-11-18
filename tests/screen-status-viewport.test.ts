import { it, expect } from "vitest";
import {
  createScreenViewportStore,
  measureScreenViewport,
} from "../src/presentation/immersion/screenViewport";
class Target extends EventTarget {
  adds = 0;
  removes = 0;
  override addEventListener(
    ...args: Parameters<EventTarget["addEventListener"]>
  ) {
    this.adds++;
    super.addEventListener(...args);
  }
  override removeEventListener(
    ...args: Parameters<EventTarget["removeEventListener"]>
  ) {
    this.removes++;
    super.removeEventListener(...args);
  }
}
function browser(width = 390, height = 844) {
  const doc = Object.assign(new Target(), { hidden: false });
  const vv = Object.assign(new Target(), {
    width,
    height,
    offsetLeft: 0,
    offsetTop: 0,
  });
  const host = Object.assign(new Target(), {
    innerWidth: width,
    innerHeight: height,
    visualViewport: vv,
    document: doc,
  });
  return { host: host as unknown as Window, win: host, vv, doc };
}
for (const [width, height] of [
  [360, 800],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1440, 900],
  [844, 390],
])
  it(`visible viewport ${width}x${height} independent of board`, () => {
    const b = browser(width, height);
    expect(measureScreenViewport(b.host)).toEqual({
      left: 0,
      top: 0,
      width,
      height,
      hidden: false,
    });
  });
it("dynamic bars, orientation and visual viewport offsets update without remounting", () => {
  const b = browser(),
    store = createScreenViewportStore(b.host);
  let notifications = 0;
  const off = store.subscribe(() => notifications++);
  b.vv.height = 760;
  b.vv.offsetTop = 42;
  b.vv.dispatchEvent(new Event("resize"));
  expect(store.getSnapshot()).toMatchObject({
    height: 760,
    top: 42,
    width: 390,
  });
  b.vv.width = 844;
  b.vv.height = 390;
  b.vv.offsetTop = 0;
  b.vv.dispatchEvent(new Event("resize"));
  expect(store.getSnapshot()).toMatchObject({
    width: 844,
    height: 390,
    top: 0,
  });
  b.vv.offsetLeft = 15;
  b.vv.dispatchEvent(new Event("scroll"));
  expect(store.getSnapshot().left).toBe(15);
  expect(notifications).toBe(3);
  off();
});
it("two effects share one listener set and release every listener on last unmount", () => {
  const b = browser(),
    store = createScreenViewportStore(b.host);
  let a = 0,
    c = 0;
  const one = store.subscribe(() => a++),
    two = store.subscribe(() => c++);
  expect([b.win.adds, b.vv.adds, b.doc.adds]).toEqual([1, 2, 1]);
  const initial = store.getSnapshot();
  b.vv.dispatchEvent(new Event("resize"));
  expect(store.getSnapshot()).toBe(initial);
  expect(a + c).toBe(0);
  b.doc.hidden = true;
  b.doc.dispatchEvent(new Event("visibilitychange"));
  expect(store.getSnapshot().hidden).toBe(true);
  expect([a, c]).toEqual([1, 1]);
  one();
  expect(b.vv.removes).toBe(0);
  two();
  expect([b.win.removes, b.vv.removes, b.doc.removes]).toEqual([1, 2, 1]);
  b.vv.width = 430;
  b.vv.dispatchEvent(new Event("resize"));
  expect([a, c]).toEqual([1, 1]);
  expect(store.getSnapshot().width).toBe(430);
});
it("browsers without visualViewport fall back to resize and do not require an API polyfill", () => {
  const b = browser();
  Object.defineProperty(b.host, "visualViewport", { value: undefined });
  const store = createScreenViewportStore(b.host),
    off = store.subscribe(() => {});
  b.win.innerHeight = 720;
  b.win.dispatchEvent(new Event("resize"));
  expect(store.getSnapshot()).toMatchObject({
    width: 390,
    height: 720,
    left: 0,
    top: 0,
  });
  off();
});
it("temporary zero/invalid metrics never collapse the layer", () => {
  const b = browser();
  b.vv.width = 0;
  b.vv.height = NaN;
  b.vv.offsetLeft = -5;
  expect(measureScreenViewport(b.host)).toMatchObject({
    width: 390,
    height: 844,
    left: 0,
  });
});

it('real frozen/burning statuses reuse screen materials without inventing terrain or leaking rivals',async()=>{
 const {atmosphereView,composeAtmosphere}=await import('../src/presentation/immersion/atmosphere');const {DEFAULT_IMMERSION}=await import('../src/presentation/immersion/settings');const {showcaseState,SHOWCASE_UNIT}=await import('../src/presentation/qa/locomotion/showcase');const s=showcaseState('mage'),local=s.units.find(u=>u.id===SHOWCASE_UNIT)!;local.statuses=[{id:'FROZEN',turnsLeft:1},{id:'BURNING',turnsLeft:2}];const tile=s.board.tiles[local.pos.y*s.board.width+local.pos.x]!;tile.terrain='NORMAL';let v=atmosphereView(s,local.id);expect(v.terrain).toBe('none');expect(composeAtmosphere(v,DEFAULT_IMMERSION)).toMatchObject({cold:true,heat:true});local.statuses=[];v=atmosphereView(s,local.id);expect(composeAtmosphere(v,DEFAULT_IMMERSION)).toMatchObject({cold:false,heat:false});s.units.push({...structuredClone(local),id:'rival',statuses:[{id:'BURNING',turnsLeft:2}]});expect(atmosphereView(s,local.id).burning).toBe(false);
});
