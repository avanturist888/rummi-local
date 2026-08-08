/**
 * Подсказка: ищет один понятный ход для текущего игрока.
 * Первый выход считает точный решатель (solver.js), после выхода —
 * только очевидные ходы без перестройки стола.
 */

import { analyze, findSets, MIN_FIRST_MELD } from './rules.js';

const label = (tile) => (tile.joker ? '★' : `${tile.num}`);
const listOf = (tiles) => tiles.map(label).join('·');

/**
 * `outlook` — результат bestFirstMeld от полной руки на начало хода
 * (считается один раз за ход в app.js); null, если игрок уже вышел.
 */
export function findHint(state, tilesOf, player, outlook) {
  if (!player.melded && outlook) {
    const byId = new Map(
      tilesOf(state, JSON.parse(state.startSnapshot).racks[state.turn]).map(
        (t) => [t.id, t]
      )
    );
    const words = outlook.sets
      .map((set) => listOf(set.map((id) => byId.get(id))))
      .join(' и ');

    if (outlook.reachedTarget) {
      return {
        found: true,
        tiles: outlook.sets.flat(),
        text: `Выход на ${outlook.points} очк.: выложите ${words}.`,
      };
    }
    if (!outlook.capped) {
      return {
        found: false,
        tiles: outlook.sets.flat(),
        text: outlook.points > 0
          ? `Из этой руки соберётся максимум ${outlook.points} очк., для выхода нужно ${MIN_FIRST_MELD}. Берите фишку.`
          : 'Из этой руки не собрать ни одного набора — берите фишку.',
      };
    }
    return { found: false, tiles: [], text: 'Слишком много вариантов — проверьте руку сами.' };
  }

  const rack = tilesOf(state, player.rack);

  // Одна фишка с руки к уже лежащему набору.
  for (let i = 0; i < state.board.length; i++) {
    const meld = tilesOf(state, state.board[i]);
    for (const tile of rack) {
      if (analyze([...meld, tile]).valid) {
        return {
          found: true,
          tiles: [tile.id],
          text: `Фишку «${label(tile)}» можно добавить к набору «${listOf(meld)}».`,
        };
      }
    }
  }

  const sets = findSets(rack);
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
