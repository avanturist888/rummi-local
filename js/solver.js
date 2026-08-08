/**
 * Точный поиск первого выхода: какие непересекающиеся наборы
 * можно собрать из руки и сколько очков они дают.
 *
 * Перебор идёт не по подмножествам фишек, а по осмысленным кандидатам
 * (все возможные группы и интервалы рядов), поэтому длинные ряды
 * учитываются целиком. Единственное упрощение: джокер не ставится
 * на место числа, которое и так есть на руке, — очков это не добавляет,
 * а освободить фишку для другого набора помогает крайне редко.
 */

import { COLORS } from './rules.js';

const NODE_CAP = 150000;

export function bestFirstMeld(tiles, target = 30) {
  const jokerIds = tiles.filter((t) => t.joker).map((t) => t.id);
  const naturals = tiles.filter((t) => !t.joker);

  // Оставшиеся копии каждой фишки: ключ «цвет+число» -> список id.
  const pool = new Map();
  for (const t of naturals) {
    const key = t.color + t.num;
    if (!pool.has(key)) pool.set(key, []);
    pool.get(key).push(t.id);
  }
  const has = (key) => (pool.get(key) || []).length > 0;

  const candidates = [];

  // Группы: подмножество имеющихся цветов + джокеры до размера 3 или 4.
  for (let num = 1; num <= 13; num++) {
    const colors = COLORS.filter((c) => has(c + num));
    for (let mask = 1; mask < 1 << colors.length; mask++) {
      const picked = colors.filter((_, i) => mask & (1 << i));
      for (const size of [3, 4]) {
        const jokers = size - picked.length;
        if (jokers < 0 || jokers > jokerIds.length) continue;
        candidates.push({
          need: picked.map((c) => c + num),
          jokers,
          points: num * size,
          cost: num * picked.length + jokers * 13,
        });
      }
    }
  }

  // Ряды: каждый интервал [a..b] каждого цвета; дырки закрывают джокеры.
  for (const color of COLORS) {
    for (let a = 1; a <= 11; a++) {
      for (let b = a + 2; b <= 13; b++) {
        const need = [];
        let points = 0;
        let cost = 0;
        for (let n = a; n <= b; n++) {
          points += n;
          if (has(color + n)) {
            need.push(color + n);
            cost += n;
          }
        }
        const jokers = b - a + 1 - need.length;
        if (!need.length || jokers > jokerIds.length) continue;
        candidates.push({ need, jokers, points, cost: cost + jokers * 13 });
      }
    }
  }

  candidates.sort((a, b) => b.points - a.points);

  // Перебор «взять кандидата / пропустить». Взятый кандидат можно взять
  // ещё раз — так работают вторые копии фишек.
  let jokersLeft = jokerIds.length;
  let availValue =
    naturals.reduce((sum, t) => sum + t.num, 0) + jokersLeft * 13;

  const chosen = [];
  let best = { points: 0, sets: [] };
  let nodes = 0;
  let capped = false;
  let stop = false;

  const record = (points) => {
    best = {
      points,
      sets: chosen.map((s) => ({ ids: s.ids.slice(), jokers: s.jokers })),
    };
    if (points >= target) stop = true;
  };

  const dfs = (i, acc) => {
    if (stop || capped) return;
    if (acc > best.points) record(acc);
    if (stop || i >= candidates.length) return;
    if (++nodes > NODE_CAP) {
      capped = true;
      return;
    }
    // Даже забрав всё оставшееся, лучший результат не улучшить.
    if (acc + availValue <= best.points) return;

    const cand = candidates[i];
    if (cand.jokers <= jokersLeft && cand.need.every(has)) {
      const taken = cand.need.map((key) => pool.get(key).pop());
      jokersLeft -= cand.jokers;
      availValue -= cand.cost;
      chosen.push({ ids: taken, jokers: cand.jokers });

      dfs(i, acc + cand.points);

      chosen.pop();
      availValue += cand.cost;
      jokersLeft += cand.jokers;
      cand.need.forEach((key, k) => pool.get(key).push(taken[k]));
    }
    dfs(i + 1, acc);
  };
  dfs(0, 0);

  // Раздаём джокеров по наборам, чтобы вернуть конкретные id.
  let jp = 0;
  const sets = best.sets.map((s) => [
    ...s.ids,
    ...jokerIds.slice(jp, (jp += s.jokers)),
  ]);

  return {
    points: best.points,
    sets,
    reachedTarget: best.points >= target,
    capped,
  };
}
