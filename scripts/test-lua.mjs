// Unit tests for the Lua scripting layer (src/lib/lua.ts) running wasmoon under Node.
// Run: node scripts/test-lua.mjs
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { LuaFactory } from 'wasmoon';

await build({
  entryPoints: ['src/lib/lua.ts'], bundle: true, platform: 'node', format: 'esm', external: ['wasmoon'],
  outfile: 'dist-electron/lua-test.mjs', logLevel: 'silent',
});
const L = await import(pathToFileURL('dist-electron/lua-test.mjs').href);

const factory = new LuaFactory();
let n = 0;
const ok = () => { n++; };

/** A fake store: a world with variables that outlives Lua states, plus a log of everything the script did. */
function makeHost() {
  const log = { sent: [], executed: [], notes: [], worlds: [] };
  let world = {
    id: 'w1', name: 'Test World', host: 'example.org', port: 4000, encoding: 'utf-8', logging: false, createdAt: '',
    triggers: [{ id: 't1', name: 'greet', pattern: 'hello', regex: false, enabled: true, group: 'chat', ignoreCase: false, send: '', sendTo: 'world', highlight: null, highlightLine: false, gag: false, oneShot: false }],
    aliases: [{ id: 'a1', name: 'gg', pattern: 'gg', regex: false, enabled: false, group: 'chat', ignoreCase: true, send: 'get all', sendTo: 'world' }],
    timers: [],
    variables: {},
    commandStacking: false, commandStackChar: ';', speedwalk: false, speedwalkPrefix: '#',
  };
  const host = {
    send: (t) => log.sent.push(t),
    execute: (t) => log.executed.push(t),
    note: (spans, kind) => log.notes.push({ kind, text: spans.map((s) => s.text).join(''), spans }),
    getVariable: (k) => world.variables[k],
    setVariable: (k, v) => { world.variables[k] = v; },
    deleteVariable: (k) => { if (!(k in world.variables)) return false; delete world.variables[k]; return true; },
    variableNames: () => Object.keys(world.variables).sort(),
    world: () => world,
    updateWorld: (w) => { world = w; log.worlds.push(w); },
    connected: () => true,
  };
  return { host, log, world: () => world };
}
const errors = (log) => log.notes.filter((x) => x.kind === 'error').map((x) => x.text);

/* ---------- a trigger calling a Lua function with wildcards ---------- */
{
  const { host, log } = makeHost();
  const lua = await L.LuaSession.create(factory, host, `
    seen = {}
    function on_tell(name, line, wildcards)
      seen = { name = name, line = line, who = wildcards[1], what = wildcards[2], whole = wildcards[0], named = wildcards.who, n = #wildcards }
      Send("reply " .. wildcards[1] .. " thanks")
      Note("Got a tell from ", wildcards[1])
    end
  `);
  assert.equal(lua.loadError, null); ok();
  lua.fire('trigger', { name: 'tell', script: 'on_tell' }, 'Bob tells you, "hi"', { wildcards: ['Bob tells you, "hi"', 'Bob', 'hi'], named: { who: 'Bob' } });
  assert.deepEqual(log.sent, ['reply Bob thanks']); ok();
  assert.deepEqual(log.notes.map((x) => x.text), ['Got a tell from Bob']); ok();
  assert.equal(errors(log).length, 0); ok();
  // Read the table back through a second function to check what Lua saw.
  lua.fire('trigger', { name: 'check', script: 'dump' }, '', undefined);
  assert.match(errors(log)[0], /no Lua function named 'dump'/); ok();
  assert.match(errors(log)[0], /trigger "check"/); ok();
  await lua.run('Note(seen.name, "|", seen.line, "|", seen.who, "|", seen.what, "|", seen.whole, "|", seen.named, "|", seen.n)');
  assert.equal(log.notes[log.notes.length - 1].text, 'tell|Bob tells you, "hi"|Bob|hi|Bob tells you, "hi"|Bob|2'); ok();
  lua.dispose();
  assert.equal(lua.open, false); ok();
}

/* ---------- inline scriptBody: %1 substitution and ... args ---------- */
{
  const { host, log } = makeHost();
  const lua = await L.LuaSession.create(factory, host, '');
  lua.fire('alias', { name: 'inline', scriptBody: 'local name, line, w = ...\nNote("inline %1 / " .. name .. " / " .. line .. " / " .. w[2])' },
    'gg sword shield', { wildcards: ['gg sword shield', 'sword', 'shield'], named: {} });
  assert.deepEqual(log.notes.map((x) => x.text), ['inline sword / inline / gg sword shield / shield']); ok();
  // A script-only item with a syntax error reports the item and a line number.
  lua.fire('timer', { name: 'bad', scriptBody: 'Note("x"\nNote("y")' }, '');
  const e = errors(log);
  assert.equal(e.length, 1); assert.match(e[0], /timer "bad", inline script/); assert.match(e[0], /:2:|line 2/); ok();
  lua.dispose();
}

/* ---------- variable persistence across states ---------- */
{
  const { host, log, world } = makeHost();
  let lua = await L.LuaSession.create(factory, host, `
    SetVariable("visits", (tonumber(GetVariable("visits") or 0)) + 1)
    SetVariable("who", "Rose")
  `);
  assert.equal(lua.loadError, null, errors(log).join('\n')); ok();
  assert.deepEqual(world().variables, { visits: '1', who: 'Rose' }, 'numbers are stored as strings'); ok();
  lua.dispose();
  // A fresh state (reload, or next connect) sees what the last one stored.
  lua = await L.LuaSession.create(factory, host, 'SetVariable("visits", (tonumber(GetVariable("visits") or 0)) + 1)');
  assert.equal(world().variables.visits, '2'); ok();
  await lua.run('Note(GetVariable("who"), "/", tostring(GetVariable("missing")), "/", tostring(DeleteVariable("who")), "/", tostring(DeleteVariable("who")))');
  assert.equal(log.notes[log.notes.length - 1].text, 'Rose/nil/0/30019'); ok();
  await lua.run('local t = GetVariableList() local ks = {} for k in pairs(t) do ks[#ks+1] = k end table.sort(ks) Note(table.concat(ks, ","))');
  assert.equal(log.notes[log.notes.length - 1].text, 'visits'); ok();
  await lua.run('Note(SetVariable("bad name", "x"))');
  assert.equal(log.notes[log.notes.length - 1].text, String(L.ERROR_CODE.eInvalidObjectLabel)); ok();
  lua.dispose();
}

/* ---------- error reporting ---------- */
{
  const { host, log } = makeHost();
  // Syntax error in the script file: reported, state still usable.
  const lua = await L.LuaSession.create(factory, host, 'function broken(\n  Note("x")\nend');
  assert.ok(lua.loadError, 'loadError set'); ok();
  assert.equal(errors(log).length, 1); assert.match(errors(log)[0], /^Lua: script file: /); ok();
  assert.ok(lua.open); ok();
  // Runtime error inside a called function carries the function name and a traceback line.
  await lua.run('function boom() local x = nil; return x.y end');
  lua.fire('trigger', { name: 'kaboom', script: 'boom' }, 'line');
  const e = errors(log);
  assert.equal(e.length, 2); assert.match(e[1], /trigger "kaboom", function boom:/); assert.match(e[1], /attempt to index/); ok();
  // A runtime error from a user chunk is reported and run() returns the message.
  const msg = await lua.run('error("custom problem")');
  assert.match(msg, /custom problem/); assert.match(errors(log)[2], /custom problem/); ok();
  // An infinite loop is stopped by the call timeout rather than hanging the app.
  const fast = await L.LuaSession.create(factory, host, 'function spin() while true do end end', { timeoutMs: 200 });
  const t0 = Date.now();
  fast.fire('timer', { name: 'spin', script: 'spin' }, '');
  assert.ok(Date.now() - t0 < 5000, 'timed out'); assert.match(errors(log).at(-1), /spin/); ok();
  fast.dispose();
  lua.dispose();
}

/* ---------- the output helpers ---------- */
{
  const { host, log } = makeHost();
  const lua = await L.LuaSession.create(factory, host, '');
  await lua.run('ColourNote("red", "", "a", "#00ff00", "black", "b") Tell("x") ColourTell("blue", "", "y") Note("z") print("p", 1, true)');
  assert.deepEqual(log.notes.map((x) => x.text), ['ab', 'xyz', 'p\t1\ttrue']); ok();
  assert.deepEqual(log.notes[0].spans.map((s) => [s.fg, s.bg]), [['red', null], ['#00ff00', 'black']]); ok();
  assert.deepEqual(log.notes[1].spans.map((s) => s.fg), [null, 'blue', null]); ok();
  await lua.run('Send("a\\nb") Execute("gg") world.Send("c") world.Note("via world")');
  assert.deepEqual(log.sent, ['a', 'b', 'c']); assert.deepEqual(log.executed, ['gg']); ok();
  assert.equal(log.notes.at(-1).text, 'via world'); ok();
  await lua.run('Note(GetInfo(2), "/", GetInfo(1), "/", tostring(GetInfo(106)), "/", WorldName(), "/", tostring(IsConnected()), "/", type(utils.timer()), "/", type(os.time()))');
  assert.equal(log.notes.at(-1).text, 'Test World/example.org/true/Test World/true/number/number'); ok();
  lua.dispose();
}

/* ---------- editing the world: Add/Delete/Enable ---------- */
{
  const { host, log, world } = makeHost();
  const lua = await L.LuaSession.create(factory, host, '');
  await lua.run(`
    check(AddTrigger("pages", "^(\\\\w+) pages: (.*)$", "", trigger_flag.Enabled + trigger_flag.RegularExpression + trigger_flag.IgnoreCase + trigger_flag.OneShot, 4, 0, "", "on_page"))
    check(AddTriggerEx("spam", "spam", "Note('gagged %0')", trigger_flag.Enabled + trigger_flag.OmitFromOutput + trigger_flag.Temporary, 0, 0, "", "", sendto.script))
    check(AddAlias("hi", "hi *", "say hello %1", alias_flag.Enabled + alias_flag.IgnoreAliasCase, "after_hi"))
    check(AddTimer("tick", 0, 5, 30, "look", timer_flag.Enabled, "on_tick"))
    check(AddTimer("noon", 12, 0, 0, "tell me it is noon", timer_flag.Enabled + timer_flag.AtTime + timer_flag.TimerNote + timer_flag.OneShot, ""))
  `);
  assert.equal(errors(log).length, 0, errors(log).join('\n')); ok();
  const w = world();
  const pages = w.triggers.find((t) => t.name === 'pages');
  assert.ok(pages); assert.equal(pages.regex, true); assert.equal(pages.ignoreCase, true); assert.equal(pages.oneShot, true);
  assert.equal(pages.script, 'on_page'); assert.equal(pages.highlight, '11'); assert.equal(pages.highlightLine, false); assert.equal(pages.temporary, undefined); ok();
  const spam = w.triggers.find((t) => t.name === 'spam');
  assert.equal(spam.gag, true); assert.equal(spam.temporary, true); assert.equal(spam.scriptBody, "Note('gagged %0')"); assert.equal(spam.send, ''); ok();
  const hi = w.aliases.find((a) => a.name === 'hi');
  assert.equal(hi.pattern, 'hi *'); assert.equal(hi.send, 'say hello %1'); assert.equal(hi.script, 'after_hi'); assert.equal(hi.ignoreCase, true); ok();
  const tick = w.timers.find((t) => t.name === 'tick');
  assert.equal(tick.everySeconds, 330); assert.equal(tick.at, null); assert.equal(tick.script, 'on_tick'); ok();
  const noon = w.timers.find((t) => t.name === 'noon');
  assert.equal(noon.at, '12:00:00'); assert.equal(noon.sendTo, 'output'); assert.equal(noon.oneShot, true); ok();
  // Re-adding the same name replaces rather than duplicates (scripts re-run on every reload).
  await lua.run('check(AddTrigger("pages", "pages:", "", trigger_flag.Enabled, 0, 0, "", "on_page2"))');
  assert.equal(world().triggers.filter((t) => t.name === 'pages').length, 1); assert.equal(world().triggers.find((t) => t.name === 'pages').script, 'on_page2'); ok();
  // Bad input is reported through return codes, which check() turns into an error.
  await lua.run('Note(AddTrigger("bad", "(unclosed", "", trigger_flag.RegularExpression, 0, 0, "", ""), " ", AddTrigger("empty", "", "", 1, 0, 0, "", ""), " ", AddTimer("t", 0, 0, 0, "", 1, ""))');
  assert.equal(log.notes.at(-1).text, `${L.ERROR_CODE.eBadRegularExpression} ${L.ERROR_CODE.eTriggerCannotBeEmpty} ${L.ERROR_CODE.eTimeInvalid}`); ok();
  await lua.run('check(AddAlias("x", "", "", 1, ""))');
  assert.match(errors(log).at(-1), /error code 30012/); ok();
  // Enable / delete / group
  await lua.run('Note(EnableTrigger("greet", false), " ", EnableTrigger("nope", true), " ", IsTrigger("greet"), " ", IsTrigger("nope"), " ", IsAlias("gg"), " ", IsTimer("tick"))');
  assert.equal(log.notes.at(-1).text, `0 ${L.ERROR_CODE.eTriggerNotFound} 0 ${L.ERROR_CODE.eTriggerNotFound} 0 0`); ok();
  assert.equal(world().triggers.find((t) => t.name === 'greet').enabled, false); ok();
  await lua.run('Note(EnableGroup("chat", true))');
  assert.equal(log.notes.at(-1).text, '2'); ok();
  assert.equal(world().triggers.find((t) => t.name === 'greet').enabled, true); assert.equal(world().aliases.find((a) => a.name === 'gg').enabled, true); ok();
  await lua.run('Note(EnableAliasGroup("chat", false), " ", EnableTriggerGroup("none", true))');
  assert.equal(log.notes.at(-1).text, '1 0'); assert.equal(world().aliases.find((a) => a.name === 'gg').enabled, false); ok();
  await lua.run('Note(DeleteTrigger("spam"), " ", DeleteTrigger("spam"), " ", DeleteAlias("hi"), " ", DeleteTimer("noon"), " ", DeleteTimer("noon"))');
  assert.equal(log.notes.at(-1).text, `0 ${L.ERROR_CODE.eTriggerNotFound} 0 0 ${L.ERROR_CODE.eTimerNotFound}`); ok();
  assert.equal(world().triggers.some((t) => t.name === 'spam'), false); assert.equal(world().timers.length, 1); ok();
  lua.dispose();
}

/* ---------- states are independent ---------- */
{
  const a = makeHost(), b = makeHost();
  const la = await L.LuaSession.create(factory, a.host, 'x = 1');
  const lb = await L.LuaSession.create(factory, b.host, 'Note(tostring(x))');
  assert.equal(b.log.notes[0].text, 'nil'); ok();
  la.dispose(); lb.dispose();
}

console.log(`test-lua: ${n} checks passed`);
