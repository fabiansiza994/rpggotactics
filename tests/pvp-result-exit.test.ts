import { it as test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const fixed = fs.readFileSync(
  new URL("../src/presentation/pvp/PvpScreen.tsx", import.meta.url),
  "utf8",
);
const source =
  "  async function exit() {\n    if (snapshot) {\n      try {\n        await api('leave', { code: snapshot.code });\n      } catch (e) {\n        setError((e as Error).message);\n        return;\n      }\n    }\n    localStorage.removeItem(LAST_ROOM);\n    alive.current = false;\n      drawRitual.reset();\n    socket.current?.close();\n    onExit();\n  }\n" +
  fn(fixed, "backToRanked") +
  fn(fixed, "recover");
function fn(src: string, name: string) {
  const tree = ts.createSourceFile(
    "PvpScreen.tsx",
    src,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let found: ts.FunctionDeclaration | undefined;
  const visit = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n;
    ts.forEachChild(n, visit);
  };
  visit(tree);
  assert(found);
  return ts.transpileModule(found.getText(tree), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
function harness(
  src: string,
  {
    finished = true,
    fail = false,
  }: { finished?: boolean; fail?: boolean } = {},
) {
  const events: string[] = [],
    alive = { current: true },
    socket = { current: null as { close(): void } | null },
    connectionGeneration = { current: 1 },
    retry = { current: 42 },
    latest = { current: { code: "LOCAL" } },
    pending = { current: { id: "pending" } },
    snapshot = { code: "LOCAL", result: finished ? { winner: 0 } : null };
  let resolveRead!: () => void;
  const read = new Promise<void>((r) => (resolveRead = r));
  const connect = async (room: string) => events.push("connect:" + room);
  const old = {
    close() {
      events.push("close");
      if (!alive.current || socket.current !== old) return;
      events.push("network:reconnecting");
      retry.current = 99;
    },
  };
  socket.current = old;
  const bindings = {
    lastRevision: { current: 7 },
    snapshot,
    api: async (path: string) => {
      events.push("api:" + path);
      if (fail) throw Error("fixture failure");
      old.close();
    },
    localStorage: { removeItem: () => events.push("forget") },
    LAST_ROOM: "LOCAL",
    alive,
    drawRitual: { reset: () => events.push("draw.reset") },
    socket,
    onExit: () => events.push("exit"),
    setError: (e: string) => events.push("error:" + e),
    connectionGeneration,
    retry,
    latest,
    pending,
    clearTimeout: (id: number) => events.push("clear:" + id),
    setSnapshot: (x: unknown) => events.push("snapshot:" + x),
    setNetwork: (x: string) => events.push("network:" + x),
    useBattleStore: { setState: () => events.push("store.clear") },
    ranked: {
      reset: () => events.push("queue.reset"),
      refresh: async () => events.push("queue.refresh"),
    },
    readState: async () => read,
    connect,
  };
  const keys = Object.keys(bindings);
  const functions = new Function(
    ...keys,
    fn(src, "exit") +
      "\n" +
      fn(src, "backToRanked") +
      "\n" +
      fn(src, "recover") +
      "\nreturn {exit,backToRanked,recover};",
  )(...keys.map((k) => (bindings as Record<string, unknown>)[k])) as {
    exit(): Promise<void>;
    backToRanked(): void;
    recover(room: string): Promise<void>;
  };
  return {
    ...functions,
    events,
    alive,
    socket,
    retry,
    latest,
    pending,
    connectionGeneration,
    resolveRead,
  };
}
test("reproduces original finished exit initiating an unnecessary leave/close notification", async () => {
  const h = harness(source);
  await h.exit();
  assert(h.events.includes("api:leave"));
  assert(h.events.includes("network:reconnecting"));
});
test("proposed terminal exit neither leaves a finished room nor signals reconnect", async () => {
  const h = harness(fixed);
  await h.exit();
  assert(!h.events.some((e) => e.startsWith("api:")));
  assert(!h.events.includes("network:reconnecting"));
  assert.equal(h.events.filter((e) => e === "exit").length, 1);
});
test("terminal exit clears queued retry, pending action and latest room before close", async () => {
  const h = harness(fixed);
  await h.exit();
  assert(h.events.includes("clear:42"));
  assert.equal(h.retry.current, null);
  assert.equal(h.pending.current, null);
  assert.equal(h.latest.current, null);
  assert.equal(h.socket.current, null);
  assert.equal(h.alive.current, false);
});
test("live exit retains authoritative leave call before navigating away", async () => {
  const h = harness(fixed, { finished: false });
  await h.exit();
  assert.equal(h.events.filter((e) => e === "api:leave").length, 1);
  assert(h.events.indexOf("api:leave") < h.events.indexOf("exit"));
});
test("failed live leave retains room and reports error without exiting", async () => {
  const h = harness(fixed, { finished: false, fail: true });
  await h.exit();
  assert(h.events.includes("error:fixture failure"));
  assert(!h.events.includes("exit"));
  assert(h.alive.current);
  assert(h.socket.current);
});
test("late recovery cannot reconnect after terminal exit", async () => {
  const h = harness(fixed);
  const p = h.recover("LOCAL");
  await h.exit();
  h.resolveRead();
  await p;
  assert(!h.events.some((e) => e.startsWith("connect:")));
});
test("return to Ranked invalidates recovery and detaches old socket", async () => {
  const h = harness(fixed);
  const p = h.recover("LOCAL");
  h.backToRanked();
  h.resolveRead();
  await p;
  assert(h.events.includes("queue.reset"));
  assert(h.events.includes("queue.refresh"));
  assert(h.events.includes("store.clear"));
  assert.equal(h.socket.current, null);
  assert(!h.events.some((e) => e.startsWith("connect:")));
});
test("keys proposed for hand and result are distinct while match identity stays unchanged", () => {
  assert(fixed.includes("key={`hand:${pvpMatchKey(snapshot)}`}"));
  assert(fixed.includes("key={`result:${pvpMatchKey(snapshot)}`}"));
  assert(fixed.includes("identity={pvpMatchKey(snapshot)}"));
});

test("terminal result exit remains available when a redundant leave would fail", async () => {
  const h = harness(fixed, { finished: true, fail: true });
  await h.exit();
  assert(h.events.includes("exit"));
  assert(!h.events.some((e) => e.startsWith("error:")));
});
test("finished exit advances connection generation before navigation to invalidate old work", async () => {
  const h = harness(fixed);
  const n = h.connectionGeneration.current;
  await h.exit();
  assert.equal(h.connectionGeneration.current, n + 1);
  assert.equal(h.latest.current, null);
  assert.equal(h.socket.current, null);
});
