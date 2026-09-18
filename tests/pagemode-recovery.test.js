'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const core = require('../src/pagemode-core.js');

test('worker progress keeps queued jobs alive beyond 90 seconds, silent workers still time out', () => {
  let receive, now = 0, id = 0;
  const timers = new Map();
  const ctx = vm.createContext({ self: { MLPagemodeCore: core }, location: { href: 'https://example.test' },
    chrome: { runtime: { onMessage: { addListener(fn) { receive = fn; } } } }, console,
    setTimeout(fn, ms) { const key = ++id; timers.set(key, { at: now + ms, fn }); return key; },
    clearTimeout(key) { timers.delete(key); } });
  vm.runInContext(fs.readFileSync(require.resolve('../src/pagemode.js'), 'utf8'), ctx);
  vm.runInContext(`
    globalThis.drops = 0;
    pmDropJob = function () { drops++; };
    pmUpdatePill = function () {};
    pageMode.active = true;
    pageMode.jobs.set('p#0', {watchdogId: setTimeout(() => pmDropJob(), 90000)});
  `, ctx);
  function advance(ms) {
    now += ms;
    for (const [key, timer] of timers) if (timer.at <= now) { timers.delete(key); timer.fn(); }
  }
  for (let i = 0; i < 10; i++) {
    advance(24000);
    receive({ type: 'PAGE_PROGRESS', pageKey: 'p', bandIndex: 0, status: 'queued' }, {}, () => {});
  }
  assert.equal(ctx.drops, 0, 'four minutes queued is not a translation failure');
  advance(90001);
  assert.equal(ctx.drops, 1, 'a silent background worker must still be detected');
});

test('late translation after watchdog timeout is rendered once instead of silently discarded', () => {
  const ctx = vm.createContext({ self: { MLPagemodeCore: core }, location: { href: 'https://example.test' },
    chrome: { runtime: { onMessage: { addListener() {} } } }, console, clearTimeout });
  vm.runInContext(fs.readFileSync(require.resolve('../src/pagemode.js'), 'utf8'), ctx);
  vm.runInContext(`
    let renders = 0;
    pmLayoutPage = function () { renders++; };
    pmUpdatePill = function () {};
    pmPump = function () {};
    const page = pmPageRecord({}, 'p');
    page.imageWidth = 800; page.imageHeight = 1000;
    page.bandCount = 1; page.state = 'empty';
    pageMode.pages.set('p', page);
    pageMode.stats.done = 1;
    pmHandleResult({pageKey:'p', bandIndex:0, bubbles:[
      {text:'Hello',translation:'Merhaba',x:100,y:100,width:100,height:60}
    ]});
    globalThis.result = {renders, state:page.state, done:pageMode.stats.done, bubbles:pageMode.stats.bubbles};
  `, ctx);
  assert.equal(ctx.result.renders, 1);
  assert.equal(ctx.result.state, 'done');
  assert.equal(ctx.result.done, 1);
  assert.equal(ctx.result.bubbles, 1);
});
