import test from 'node:test';
import assert from 'node:assert/strict';

import { bestFirstMeld } from '../js/solver.js';

let seq = 0;
const t = (color, num) => ({ id: `${color}${num}_${seq++}`, color, num, joker: false });
const joker = () => ({ id: `j${seq++}`, color: 'r', num: 0, joker: true });

test('простая группа на 33 очка — выход есть', () => {
  const res = bestFirstMeld([t('r', 11), t('b', 11), t('k', 11), t('r', 2)]);
  assert.equal(res.reachedTarget, true);
  assert.ok(res.points >= 30);
  assert.equal(res.sets.length, 1);
});

test('два дешёвых набора складываются в выход', () => {
  // ряд 1-2-3 (6) + группа 9-9-9 (27) = 33
  const res = bestFirstMeld([
    t('r', 1), t('r', 2), t('r', 3),
    t('b', 9), t('k', 9), t('o', 9),
  ]);
  assert.equal(res.reachedTarget, true);
  assert.equal(res.sets.length, 2);
});

test('длинный ряд считается целиком, а не куском из 5 фишек', () => {
  // 1+2+...+8 = 36; любой короткий кусок < 30
  const res = bestFirstMeld([
    t('b', 1), t('b', 2), t('b', 3), t('b', 4),
    t('b', 5), t('b', 6), t('b', 7), t('b', 8),
  ]);
  assert.equal(res.reachedTarget, true);
});

test('джокер закрывает дырку в ряду', () => {
  const res = bestFirstMeld([t('o', 10), t('o', 12), joker()]);
  assert.equal(res.reachedTarget, true); // 10+11+12 = 33
  assert.equal(res.sets[0].length, 3);
});

test('джокер в группе', () => {
  const res = bestFirstMeld([t('r', 12), t('b', 12), joker()]);
  assert.equal(res.reachedTarget, true); // 12*3 = 36
});

test('вторые копии фишек используются', () => {
  // две r10 + b10 + k10: группа 10-10-10 (30) из одной копии r10
  const res = bestFirstMeld([t('r', 10), t('r', 10), t('b', 10), t('k', 10)]);
  assert.equal(res.reachedTarget, true);
});

test('выход невозможен — честно говорит максимум', () => {
  // группа 5-5-5 = 15, больше ничего
  const res = bestFirstMeld([t('r', 5), t('b', 5), t('k', 5), t('r', 1), t('b', 2)]);
  assert.equal(res.reachedTarget, false);
  assert.equal(res.capped, false);
  assert.equal(res.points, 15);
});

test('совсем нет наборов — ноль очков', () => {
  const res = bestFirstMeld([t('r', 1), t('b', 5), t('k', 9)]);
  assert.equal(res.reachedTarget, false);
  assert.equal(res.points, 0);
  assert.deepEqual(res.sets, []);
});

test('ряд 1..7 одного цвета не дотягивает до 30', () => {
  // 1+2+...+7 = 28
  const res = bestFirstMeld([
    t('k', 1), t('k', 2), t('k', 3), t('k', 4), t('k', 5), t('k', 6), t('k', 7),
  ]);
  assert.equal(res.reachedTarget, false);
  assert.equal(res.points, 28);
});

test('полная рука из 14 случайных фишек обсчитывается быстро', () => {
  const colors = ['r', 'b', 'o', 'k'];
  for (let round = 0; round < 20; round++) {
    const rack = [];
    for (let i = 0; i < 14; i++) {
      rack.push(t(colors[(round + i * 7) % 4], ((round * 5 + i * 3) % 13) + 1));
    }
    const started = Date.now();
    const res = bestFirstMeld(rack);
    assert.ok(Date.now() - started < 1000, 'решатель должен отвечать быстро');
    assert.equal(typeof res.points, 'number');
  }
});
