'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGate, DEFAULT_MAX_HIGH_STREAK } = require('./priorityGate');

const tick = () => new Promise((r) => setImmediate(r));

// Runs `fn` inside the gate, the way proxyLimiter.js and browser.js use it.
async function within(gate, fn, priority) {
  await gate.acquire(priority);
  try {
    return await fn();
  } finally {
    gate.release();
  }
}

// A gate of size 1 whose only slot is held until `release()` is called, so every later caller
// queues.
async function heldGate() {
  const gate = createGate({ limit: () => 1 });
  await gate.acquire();
  return { gate, release: () => gate.release() };
}

test('priorityGate — never runs more than `limit` callers at once', async () => {
  const gate = createGate({ limit: () => 2 });
  let inFlight = 0;
  let peak = 0;
  const call = () =>
    within(gate, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    });
  await Promise.all(Array.from({ length: 6 }, call));
  assert.equal(peak, 2);
  assert.deepEqual(gate.stats(), { active: 0, waitingHigh: 0, waitingNormal: 0 });
});

test('priorityGate — acquire resolves with 0 when a slot is free, and with the wait otherwise', async () => {
  const { gate, release } = await heldGate();
  assert.equal(gate.stats().active, 1);
  const waiting = gate.acquire();
  setTimeout(release, 20);
  assert.ok((await waiting) >= 15);
});

test('priorityGate — a high-priority caller takes the next slot ahead of queued normal ones', async () => {
  const { gate, release } = await heldGate();
  const order = [];
  const queued = [
    within(gate, async () => order.push('normal-1')),
    within(gate, async () => order.push('normal-2')),
    within(gate, async () => order.push('high'), 'high'),
  ];
  await tick();
  release();
  await Promise.all(queued);
  assert.deepEqual(order, ['high', 'normal-1', 'normal-2']);
});

test('priorityGate — callers stay FIFO within a tier', async () => {
  const { gate, release } = await heldGate();
  const order = [];
  const queued = ['h1', 'h2', 'h3'].map((id) => within(gate, async () => order.push(id), 'high'));
  await tick();
  release();
  await Promise.all(queued);
  assert.deepEqual(order, ['h1', 'h2', 'h3']);
});

test('priorityGate — normal callers are not starved by a steady stream of high ones', async () => {
  const { gate, release } = await heldGate();
  const order = [];
  const queued = [
    within(gate, async () => order.push('normal')),
    ...Array.from({ length: 8 }, (_, i) => within(gate, async () => order.push(`high-${i}`), 'high')),
  ];
  await tick();
  release();
  await Promise.all(queued);
  assert.equal(order.indexOf('normal'), DEFAULT_MAX_HIGH_STREAK);
  assert.equal(order.length, 9);
});

test('priorityGate — an unknown priority is treated as normal, never high', async () => {
  const { gate, release } = await heldGate();
  const order = [];
  const queued = [
    within(gate, async () => order.push('bogus'), 'urgent'),
    within(gate, async () => order.push('high'), 'high'),
  ];
  await tick();
  release();
  await Promise.all(queued);
  assert.deepEqual(order, ['high', 'bogus']);
});
