/**
 * Правила Руммикуба: колода, разбор наборов, стоимость фишек.
 * Модуль чистый — без DOM и без глобального состояния.
 */

export const COLORS = ['r', 'b', 'o', 'k'];

export const COLOR_LABELS = {
  r: 'красный',
  b: 'синий',
  o: 'оранжевый',
  k: 'чёрный',
};

export const JOKER_VALUE = 30;
export const MIN_FIRST_MELD = 30;
export const RACK_SIZE = 14;

/** Полная колода: 2 × (1..13 × 4 цвета) + 2 джокера = 106 фишек. */
export function createDeck() {
  const deck = [];
  for (let copy = 0; copy < 2; copy++) {
    for (const color of COLORS) {
      for (let num = 1; num <= 13; num++) {
        deck.push({ id: `${color}${num}_${copy}`, color, num, joker: false });
      }
    }
  }
  deck.push({ id: 'j0', color: 'r', num: 0, joker: true });
  deck.push({ id: 'j1', color: 'k', num: 0, joker: true });
  return deck;
}

/** Стоимость фишки на руке при подсчёте очков в конце партии. */
export function tileValue(tile) {
  return tile.joker ? JOKER_VALUE : tile.num;
}

/** Сумма фишек на руке. */
export function handValue(tiles) {
  return tiles.reduce((sum, t) => sum + tileValue(t), 0);
}

/**
 * Разбирает набор фишек.
 * Возвращает { valid, type, ordered, values, points, reason }.
 * `ordered` — фишки в правильном порядке для показа,
 * `values` — какое число изображает каждая фишка (важно для джокеров).
 */
export function analyze(tiles) {
  const fail = (reason) => ({
    valid: false,
    type: null,
    ordered: tiles.slice(),
    values: tiles.map((t) => (t.joker ? 0 : t.num)),
    points: 0,
    reason,
  });

  if (!tiles.length) return fail('пусто');
  if (tiles.length < 3) return fail('нужно минимум 3 фишки');
  if (tiles.length > 13) return fail('слишком много фишек');

  const jokers = tiles.filter((t) => t.joker);
  const naturals = tiles.filter((t) => !t.joker);

  const variants = [
    asGroup(naturals, jokers, tiles.length),
    asRun(naturals, jokers, tiles.length),
  ].filter(Boolean);

  if (!variants.length) return fail(explainFailure(naturals, jokers, tiles.length));

  // Если фишки складываются и в набор, и в ряд (например «5 + 2 джокера»),
  // берём вариант подороже — игрок объявил бы именно его.
  variants.sort((a, b) => b.points - a.points);
  return { valid: true, reason: '', ...variants[0] };
}

/** Набор: 3–4 фишки одного числа разных цветов. */
function asGroup(naturals, jokers, size) {
  if (size < 3 || size > 4) return null;
  if (!naturals.length) return null;

  const num = naturals[0].num;
  if (!naturals.every((t) => t.num === num)) return null;

  const used = new Set(naturals.map((t) => t.color));
  if (used.size !== naturals.length) return null;

  const ordered = [...naturals].sort(
    (a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color)
  );
  ordered.push(...jokers);

  return {
    type: 'group',
    ordered,
    values: ordered.map(() => num),
    points: num * size,
  };
}

/** Ряд: 3+ фишки одного цвета подряд по возрастанию, от 1 до 13. */
function asRun(naturals, jokers, size) {
  if (size < 3) return null;
  if (!naturals.length) return null;

  const color = naturals[0].color;
  if (!naturals.every((t) => t.color === color)) return null;

  const nums = naturals.map((t) => t.num);
  if (new Set(nums).size !== nums.length) return null;

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min + 1;

  const gaps = span - naturals.length;
  if (gaps > jokers.length) return null;

  // Оставшиеся джокеры удлиняют ряд по краям; тянем вверх — так дороже.
  const spare = jokers.length - gaps;
  const roomAbove = 13 - max;
  const roomBelow = min - 1;
  if (spare > roomAbove + roomBelow) return null;

  const useAbove = Math.min(spare, roomAbove);
  const start = min - (spare - useAbove);
  const end = max + useAbove;

  const byNum = new Map(naturals.map((t) => [t.num, t]));
  const spareJokers = jokers.slice();
  const ordered = [];
  const values = [];
  for (let n = start; n <= end; n++) {
    ordered.push(byNum.get(n) || spareJokers.pop());
    values.push(n);
  }

  return {
    type: 'run',
    ordered,
    values,
    points: values.reduce((a, b) => a + b, 0),
  };
}

/** Понятное объяснение, почему фишки не складываются. */
function explainFailure(naturals, jokers, size) {
  if (!naturals.length) return 'из одних джокеров набор не собрать';

  const sameNum = naturals.every((t) => t.num === naturals[0].num);
  const sameColor = naturals.every((t) => t.color === naturals[0].color);

  if (sameNum && size > 4) return 'в наборе одинаковых чисел не больше 4 фишек';
  if (sameNum) {
    const colors = naturals.map((t) => t.color);
    if (new Set(colors).size !== colors.length) return 'в наборе повторяется цвет';
  }
  if (sameColor) {
    const nums = naturals.map((t) => t.num);
    if (new Set(nums).size !== nums.length) return 'в ряду повторяется число';
    return 'в ряду не хватает джокеров, чтобы закрыть пропуски';
  }
  return 'это не набор и не ряд';
}

/**
 * Все допустимые наборы, которые можно собрать из данных фишек.
 * Перебор подмножеств до `maxSize` — используется подсказкой.
 */
export function findSets(tiles, maxSize = 5) {
  const found = [];
  const n = tiles.length;
  const combo = [];

  const walk = (start, size) => {
    if (combo.length >= 3) {
      const res = analyze(combo);
      if (res.valid) found.push({ tiles: combo.slice(), points: res.points, type: res.type });
    }
    if (combo.length === size) return;
    for (let i = start; i < n; i++) {
      combo.push(tiles[i]);
      walk(i + 1, size);
      combo.pop();
    }
  };

  walk(0, Math.min(maxSize, n));
  return found.sort((a, b) => b.points - a.points);
}
