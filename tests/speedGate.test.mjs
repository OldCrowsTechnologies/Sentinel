import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speedGate } from '../lib/speedGate.ts';

test('parked/idle = full confidence (the validated case)', () => {
  const g = speedGate(0);
  assert.equal(g.armed, true);
  assert.equal(g.thresholdAddDb, 0);
  assert.equal(g.confScale, 1);
  assert.equal(g.regime, 'parked');
});

test('in-town raises the bar but stays armed', () => {
  const g = speedGate(25);
  assert.equal(g.armed, true);
  assert.equal(g.regime, 'in-town');
  assert.ok(g.thresholdAddDb > 0 && g.thresholdAddDb < 10, `add ${g.thresholdAddDb}`);
  assert.ok(g.confScale < 1 && g.confScale > 0.3, `scale ${g.confScale}`);
});

test('sustained highway stands the node down -- no at-speed claim', () => {
  const g = speedGate(70);
  assert.equal(g.armed, false);
  assert.equal(g.confScale, 0);
  assert.equal(g.regime, 'highway-standdown');
});

test('the gate is monotonic: faster never lowers the bar', () => {
  let prev = -1;
  for (let mph = 0; mph <= 60; mph += 5) {
    const add = speedGate(mph).thresholdAddDb;
    assert.ok(add >= prev, `threshold add dropped at ${mph} mph`);
    prev = add;
  }
});

test('garbage speed is treated as parked, not a crash', () => {
  assert.equal(speedGate(NaN).armed, true);
  assert.equal(speedGate(-5).regime, 'parked');
});
