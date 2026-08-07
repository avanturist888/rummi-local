/**
 * Подсказка: ищет один понятный ход для текущего игрока.
 * Полный перебор перестроек стола не делается — только очевидные ходы.
 */

import { analyze, findSets, MIN_FIRST_MELD } from './rules.js';

const label = (tile) => (tile.joker ? 'джокер' : `${tile.num}`);
const listOf = (tiles) => tiles.map(label).join(' · ');

export function findHint(state, tilesOf, player) {
  const rack = tilesOf(state, player.rack);
  const sets = findSets(rack);

  if (!player.melded) {
    const combo = pickCombo(sets, MIN_FIRST_MELD);
    if (combo) {
      const total = combo.reduce((sum, s) => sum + s.points, 0);
      const words = combo.map((s) => listOf(s.tiles)).join(' и ');
      return {
        found: true,
        tiles: combo.flatMap((s) => s.tiles.map((t) => t.id)),
        text: `Первый выход на ${total} очк.: выложите ${words}.`,
      };
    }
    const best = sets[0];
    if (best) {
      return {
        found: false,
        tiles: best.tiles.map((t) => t.id),
        text: `Набор есть (${listOf(best.tiles)}, ${best.points} очк.), но для первого выхода нужно ${MIN_FIRST_MELD}. Берите фишку.`,
      };
    }
    return { found: false, tiles: [], text: 'Готового набора нет — берите фишку из мешка.' };
  }

  // Одна фишка с руки к уже лежащему набору.
  for (let i = 0; i < state.board.length; i++) {
    const meld = tilesOf(state, state.board[i]);
    for (const tile of rack) {
      if (analyze([...meld, tile]).valid) {
        return {
          found: true,
          tiles: [tile.id],
          meldIndex: i,
          text: `Фишку «${label(tile)}» можно добавить к набору №${i + 1}.`,
        };
      }
    }
  }

  if (sets.length) {
    const best = sets[0];
    return {
      found: true,
      tiles: best.tiles.map((t) => t.id),
      text: `Новый набор: ${listOf(best.tiles)} (${best.points} очк.).`,
    };
  }

  return {
    found: false,
    tiles: [],
    text: 'Простых ходов нет. Попробуйте перестроить наборы на столе или возьмите фишку.',
  };
}

/** Жадно набирает непересекающиеся наборы до нужной суммы очков. */
function pickCombo(sets, target) {
  for (let seed = 0; seed < Math.min(sets.length, 40); seed++) {
    const used = new Set();
    const chosen = [];
    let total = 0;

    const take = (set) => {
      if (set.tiles.some((t) => used.has(t.id))) return false;
      set.tiles.forEach((t) => used.add(t.id));
      chosen.push(set);
      total += set.points;
      return true;
    };

    take(sets[seed]);
    for (let i = 0; i < sets.length && total < target; i++) {
      if (i !== seed) take(sets[i]);
    }
    if (total >= target) return chosen;
  }
  return null;
}
