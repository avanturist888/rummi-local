import test from 'node:test';
import assert from 'node:assert/strict';

import { analyze, createDeck, findSets, handValue, splitRun } from '../js/rules.js';

let seq = 0;
const t = (color, num) => ({ id: `${color}${num}_${seq++}`, color, num, joker: false });
const joker = () => ({ id: `j${seq++}`, color: 'r', num: 0, joker: true });

test('колода — 106 фишек, 2 джокера, каждая пара уникальна', () => {
  const deck = createDeck();
  assert.equal(deck.length, 106);
  assert.equal(deck.filter((x) => x.joker).length, 2);
  assert.equal(new Set(deck.map((x) => x.id)).size, 106);
});

test('группа: три разных цвета одного числа', () => {
  const res = analyze([t('r', 7), t('b', 7), t('k', 7)]);
  assert.equal(res.valid, true);
  assert.equal(res.type, 'group');
  assert.equal(res.points, 21);
});

test('группа из четырёх цветов', () => {
  const res = analyze([t('r', 9), t('b', 9), t('k', 9), t('o', 9)]);
  assert.equal(res.valid, true);
  assert.equal(res.points, 36);
});

test('повтор цвета в группе недопустим', () => {
  const res = analyze([t('r', 7), t('r', 7), t('b', 7)]);
  assert.equal(res.valid, false);
});

test('ряд одного цвета подряд', () => {
  const res = analyze([t('b', 5), t('b', 3), t('b', 4)]);
  assert.equal(res.valid, true);
  assert.equal(res.type, 'run');
  assert.equal(res.points, 12);
  assert.deepEqual(res.ordered.map((x) => x.num), [3, 4, 5]);
});

test('ряд не заворачивается через 13 к 1', () => {
  assert.equal(analyze([t('b', 12), t('b', 13), t('b', 1)]).valid, false);
});

test('джокер закрывает дырку в ряду', () => {
  const res = analyze([t('o', 4), joker(), t('o', 6)]);
  assert.equal(res.valid, true);
  assert.equal(res.type, 'run');
  assert.deepEqual(res.values, [4, 5, 6]);
  assert.equal(res.points, 15);
});

test('джокер достраивает ряд с краю — берём самый дорогой вариант', () => {
  const res = analyze([t('o', 4), t('o', 5), joker()]);
  assert.equal(res.valid, true);
  assert.deepEqual(res.values, [4, 5, 6]);
});

test('джокер у 13 уходит вниз, а не за границу', () => {
  const res = analyze([t('k', 12), t('k', 13), joker()]);
  assert.equal(res.valid, true);
  assert.deepEqual(res.values, [11, 12, 13]);
  assert.equal(res.points, 36);
});

test('два джокера и одна фишка — берётся более дорогой ряд, а не группа', () => {
  const res = analyze([t('r', 5), joker(), joker()]);
  assert.equal(res.valid, true);
  assert.equal(res.type, 'run');
  assert.equal(res.points, 18); // 5+6+7 дороже группы 5+5+5
});

test('джокер в группе показывает число группы', () => {
  const res = analyze([t('r', 11), t('b', 11), joker(), t('k', 11)]);
  assert.equal(res.valid, true);
  assert.equal(res.type, 'group');
  assert.equal(res.points, 44);
});

test('двух фишек мало', () => {
  assert.equal(analyze([t('r', 5), t('r', 6)]).valid, false);
});

test('пять фишек одного числа — не группа', () => {
  assert.equal(
    analyze([t('r', 3), t('b', 3), t('k', 3), t('o', 3), joker()]).valid,
    false
  );
});

test('джокеров не хватает на дырки', () => {
  assert.equal(analyze([t('b', 2), joker(), t('b', 6)]).valid, false);
});

test('стоимость руки: джокер стоит 30', () => {
  assert.equal(handValue([t('r', 13), joker(), t('b', 1)]), 44);
});

test('splitRun: ряд с дыркой распадается на два правильных куска', () => {
  const parts = splitRun([t('o', 3), t('o', 4), t('o', 5), t('o', 7), t('o', 8), t('o', 9)]);
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0].map((x) => x.num), [3, 4, 5]);
  assert.deepEqual(parts[1].map((x) => x.num), [7, 8, 9]);
  assert.ok(parts.every((p) => analyze(p).valid));
});

test('splitRun: короткому куску не хватает фишек — не разбиваем', () => {
  assert.equal(splitRun([t('o', 3), t('o', 4), t('o', 5), t('o', 6), t('o', 8)]), null);
});

test('splitRun: джокер достаётся короткой половине', () => {
  const parts = splitRun([t('b', 3), t('b', 4), t('b', 5), t('b', 8), t('b', 9), joker()]);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => analyze(p).valid));
  const short = parts.find((p) => p.some((x) => x.joker));
  assert.deepEqual(short.filter((x) => !x.joker).map((x) => x.num), [8, 9]);
});

test('splitRun: разные цвета или повторы — это не сломанный ряд', () => {
  assert.equal(splitRun([t('r', 3), t('b', 4), t('r', 7), t('r', 8), t('r', 9)]), null);
  assert.equal(splitRun([t('r', 3), t('r', 3), t('r', 7), t('r', 8), t('r', 9)]), null);
});

test('findSets находит и ряд, и группу', () => {
  const hand = [t('r', 1), t('r', 2), t('r', 3), t('b', 9), t('k', 9), t('o', 9)];
  const sets = findSets(hand);
  const kinds = new Set(sets.map((s) => s.type));
  assert.ok(kinds.has('run'));
  assert.ok(kinds.has('group'));
  assert.equal(sets[0].points, 27); // 9+9+9 — самый дорогой
});
