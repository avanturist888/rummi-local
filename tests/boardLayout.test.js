import test from 'node:test';
import assert from 'node:assert/strict';

import * as G from '../js/game.js';
import { createBoardLayout } from '../js/boardLayout.js';

function setup({ racks, board = [] }) {
  const state = G.newGame(racks.map((_, i) => `И${i + 1}`));
  const used = new Set();
  const claim = (ids) => {
    ids.forEach((id) => {
      assert.ok(state.tiles[id], `нет такой фишки: ${id}`);
      assert.ok(!used.has(id), `фишка ${id} уже занята`);
      used.add(id);
    });
    return ids.slice();
  };

  state.board = board.map(claim);
  state.players.forEach((player, i) => {
    player.rack = claim(racks[i]);
    player.melded = true;
  });
  state.pool = Object.keys(state.tiles).filter((id) => !used.has(id));
  G.beginTurn(state);
  return state;
}

const R = (n, c = 0) => `r${n}_${c}`;
const B = (n, c = 0) => `b${n}_${c}`;
const O = (n, c = 0) => `o${n}_${c}`;
const K = (n, c = 0) => `k${n}_${c}`;

const meldsOf = (list) => list.map((e) => e.meld);

test('reset раскладывает группы слева по числу и ряды справа по цвету и началу', () => {
  const state = setup({
    racks: [[R(1)], [B(1)]],
    board: [
      [O(4), O(5), O(6)],
      [R(10), B(10), K(10)],
      [R(7), R(8), R(9)],
      [R(3), B(3), O(3)],
      [R(2), R(3, 1), R(4)],
    ],
  });
  const layout = createBoardLayout();
  const view = layout.reset(state.board, state.tiles);

  assert.deepEqual(meldsOf(view.groups), [
    [R(3), B(3), O(3)],
    [R(10), B(10), K(10)],
  ]);
  assert.deepEqual(meldsOf(view.runs), [
    [R(2), R(3, 1), R(4)],
    [R(7), R(8), R(9)],
    [O(4), O(5), O(6)],
  ]);
});

test('снятие фишки не меняет порядок соседей и не пересортировывает ряд', () => {
  const state = setup({
    racks: [[B(13)], [K(1)]],
    board: [
      [R(4), R(5), R(6), R(7)],
      [R(5, 1), R(6, 1), R(7, 1)],
      [B(1), B(2), B(3)],
    ],
  });
  const layout = createBoardLayout();
  layout.reset(state.board, state.tiles);

  // Забираем r4_0 из первого ряда -> теперь он начинается с 5 (как и второй),
  // а если забрать ещё r5_0 -> начинается с 6 (выше второго!), но порядок должен сохраниться.
  G.moveTiles(state, [R(4)], -1);
  let view = layout.sync(state.board, state.tiles);
  assert.deepEqual(meldsOf(view.runs).slice(0, 3), [
    [R(5), R(6), R(7)],
    [R(5, 1), R(6, 1), R(7, 1)],
    [B(1), B(2), B(3)],
  ]);

  // Забираем ещё r5_0 из первого ряда — он становится невалидным [r6, r7],
  // но остаётся на первом месте в колонке рядов.
  G.moveTiles(state, [R(5)], 3);
  view = layout.sync(state.board, state.tiles);
  assert.equal(view.runs[0].info.valid, false);
  assert.deepEqual(view.runs[0].meld, [R(6), R(7)]);
  assert.deepEqual(view.runs[1].meld, [R(5, 1), R(6, 1), R(7, 1)]);
  assert.deepEqual(view.runs[2].meld, [B(1), B(2), B(3)]);
});

test('сломанный набор остаётся в своей колонке и на своём месте, даже если осталась 1 фишка', () => {
  const state = setup({
    racks: [[O(1)], [K(1)]],
    board: [
      [R(3), B(3), O(3)],
      [R(7), B(7), K(7)],
      [R(11), B(11), O(11)],
    ],
  });
  const layout = createBoardLayout();
  layout.reset(state.board, state.tiles);

  // Забираем две фишки из средней группы (7), оставляя одинокую r7_0.
  G.moveTiles(state, [B(7), K(7)], -1);
  const view = layout.sync(state.board, state.tiles);

  assert.equal(view.groups.length, 4);
  assert.deepEqual(view.groups[0].meld, [R(3), B(3), O(3)]);
  assert.deepEqual(view.groups[1].meld, [R(7)], 'остаток средней группы остался на месте 1');
  assert.equal(view.groups[1].info.valid, false);
  assert.deepEqual(view.groups[2].meld, [R(11), B(11), O(11)]);
  assert.deepEqual(view.groups[3].meld, [B(7), K(7)], 'новый неполный набор из 7 встал в конец групп');
});

test('новый набор с руки встаёт в конец своей колонки и не двигает существующие выше', () => {
  const state = setup({
    racks: [[R(2), B(2), K(2), R(1), R(2, 1), R(3)], [O(1)]],
    board: [
      [R(9), B(9), O(9)],
      [B(5), B(6), B(7)],
    ],
  });
  const layout = createBoardLayout();
  layout.reset(state.board, state.tiles);

  // Выкладываем группу двоек (меньше 9) — должна встать ПОСЛЕ девяток, а не выше.
  G.moveTiles(state, [R(2), B(2), K(2)], -1);
  // Выкладываем красный ряд 1-2-3 (раньше синего 5-6-7) — должен встать ПОСЛЕ синего.
  G.moveTiles(state, [R(1), R(2, 1), R(3)], -1);

  const view = layout.sync(state.board, state.tiles);
  assert.deepEqual(meldsOf(view.groups), [
    [R(9), B(9), O(9)],
    [R(2), B(2), K(2)],
  ]);
  assert.deepEqual(meldsOf(view.runs), [
    [B(5), B(6), B(7)],
    [R(1), R(2, 1), R(3)],
  ]);
});

test('новый набор с неясным типом встаёт в конец колонки рядов, а не в отдельную зону', () => {
  const state = setup({
    racks: [[R(4), B(9)], [O(1)]],
    board: [
      [R(8), B(8), K(8)],
      [O(1, 1), O(2), O(3)],
    ],
  });
  const layout = createBoardLayout();
  layout.reset(state.board, state.tiles);

  G.moveTiles(state, [R(4), B(9)], -1);
  const view = layout.sync(state.board, state.tiles);

  assert.equal(view.groups.length, 1);
  assert.deepEqual(meldsOf(view.runs), [
    [O(1, 1), O(2), O(3)],
    [R(4), B(9)],
  ]);
});

test('распад длинного ряда (splitRun) ставит второй кусок сразу после первого в той же колонке', () => {
  const state = setup({
    racks: [[R(1)], [K(1)]],
    board: [
      [R(2), R(3), R(4)],
      [O(3), O(4), O(5), O(6), O(7), O(8), O(9), O(10)],
      [K(10), K(11), K(12)],
    ],
  });
  const layout = createBoardLayout();
  layout.reset(state.board, state.tiles);

  // Забираем шестёрку из середины оранжевого ряда: правая половина длиннее левой,
  // но левая всё равно остаётся первой, а правая встаёт сразу за ней.
  G.moveTiles(state, [O(6)], -1);
  const view = layout.sync(state.board, state.tiles);

  assert.deepEqual(meldsOf(view.runs), [
    [R(2), R(3), R(4)],
    [O(3), O(4), O(5)],
    [O(7), O(8), O(9), O(10)],
    [K(10), K(11), K(12)],
    [O(6)],
  ]);
});

test('слияние двух рядов сохраняет место целевого набора, даже если источник длиннее', () => {
  const state = setup({
    racks: [[O(1)], [K(1)]],
    board: [
      [R(1), R(2), R(3), R(4), R(5)],
      [R(4, 1), R(5, 1), R(6, 1)],
      [R(6), R(7), R(8)],
    ],
  });
  const layout = createBoardLayout();
  layout.reset(state.board, state.tiles);

  // Переносим весь первый ряд (5 фишек) в третий (3 фишки):
  // итоговый 1–8 должен остаться под нетронутым 4–6, а не прыгать над ним.
  const targetPrevTiles = state.board[2].slice();
  layout.push();
  G.moveTiles(state, state.board[0].slice(), 2);
  const view = layout.sync(state.board, state.tiles, { targetPrevTiles });

  assert.deepEqual(meldsOf(view.runs), [
    [R(4, 1), R(5, 1), R(6, 1)],
    [R(6), R(7), R(8), R(1), R(2), R(3), R(4), R(5)],
  ]);

  // Восстановление из истории без отдельного сохранения раскладки тоже держит 1–8 под 4–6.
  const rebuilt = createBoardLayout();
  const rebuiltView = rebuilt.rebuildFromState(state);
  assert.deepEqual(meldsOf(rebuiltView.runs), meldsOf(view.runs));
});

test('слияние сохраняет место цели, даже если вся цель попала в выделение (и после rebuildFromState)', () => {
  const state = setup({
    racks: [[O(1)], [K(1)]],
    board: [
      [R(1), R(2), R(3), R(4), R(5)],
      [R(4, 1), R(5, 1), R(6, 1)],
      [R(6), R(7), R(8)],
    ],
  });
  const layout = createBoardLayout();
  layout.reset(state.board, state.tiles);

  // Выделена вся цель (6,7,8) и весь источник (1–5) в произвольном порядке;
  // как и placeSelection, переносим только фишки, которых ещё нет в цели.
  const targetPrevTiles = state.board[2].slice();
  const targetSet = new Set(targetPrevTiles);
  const picked = [R(1), R(7), R(6), R(8), R(2), R(3), R(4), R(5)];
  const movedIds = picked.filter((id) => !targetSet.has(id));
  layout.push();
  G.moveTiles(state, movedIds, 2);
  const view = layout.sync(state.board, state.tiles, { targetPrevTiles });

  assert.deepEqual(meldsOf(view.runs), [
    [R(4, 1), R(5, 1), R(6, 1)],
    [R(6), R(7), R(8), R(1), R(2), R(3), R(4), R(5)],
  ]);

  const rebuilt = createBoardLayout();
  const rebuiltView = rebuilt.rebuildFromState(state);
  assert.deepEqual(meldsOf(rebuiltView.runs), meldsOf(view.runs));
});

test('undo, resetTurn и endTurn корректно синхронизируют и причёсывают раскладку', () => {
  const state = setup({
    racks: [[R(2), B(2), K(2), O(1)], [K(1)]],
    board: [
      [R(9), B(9), O(9)],
      [O(3), O(4), O(5), O(6), O(7), O(8), O(9, 1)],
      [K(10), K(11), K(12)],
    ],
  });
  const layout = createBoardLayout();
  layout.reset(state.board, state.tiles);

  // Ход 1: выкладываем двойки в конец групп.
  layout.push();
  G.moveTiles(state, [R(2), B(2), K(2)], -1);
  let view = layout.sync(state.board, state.tiles);
  assert.deepEqual(meldsOf(view.groups), [
    [R(9), B(9), O(9)],
    [R(2), B(2), K(2)],
  ]);

  // Ход 2: разбиваем длинный оранжевый ряд.
  layout.push();
  G.moveTiles(state, [O(6)], -1);
  view = layout.sync(state.board, state.tiles);
  assert.deepEqual(meldsOf(view.runs), [
    [O(3), O(4), O(5)],
    [O(7), O(8), O(9, 1)],
    [K(10), K(11), K(12)],
    [O(6)],
  ]);

  // Undo отменяет разбиение ряда.
  assert.equal(G.undo(state), true);
  layout.pop();
  view = layout.sync(state.board, state.tiles);
  assert.deepEqual(meldsOf(view.runs), [
    [O(3), O(4), O(5), O(6), O(7), O(8), O(9, 1)],
    [K(10), K(11), K(12)],
  ]);

  // resetTurn возвращает исходный порядок обеих колонок.
  G.resetTurn(state);
  view = layout.reset(state.board, state.tiles);
  assert.deepEqual(meldsOf(view.groups), [[R(9), B(9), O(9)]]);
  assert.deepEqual(meldsOf(view.runs), [
    [O(3), O(4), O(5), O(6), O(7), O(8), O(9, 1)],
    [K(10), K(11), K(12)],
  ]);

  // Повторно выкладываем двойки и завершаем ход: после endTurn + reset двойки выше девяток.
  layout.push();
  G.moveTiles(state, [R(2), B(2), K(2)], -1);
  layout.sync(state.board, state.tiles);
  const ended = G.endTurn(state);
  assert.equal(ended.ok, true);
  view = layout.reset(state.board, state.tiles);
  assert.deepEqual(meldsOf(view.groups), [
    [R(2), B(2), K(2)],
    [R(9), B(9), O(9)],
  ]);
});

test('загрузка посреди хода (rebuildFromState и serialize/restore) сохраняет порядок и историю undo', () => {
  const state = setup({
    racks: [[R(1), R(2), R(3)], [K(1)]],
    board: [
      [B(7), B(8), B(9)],
      [O(4), O(5), O(6)],
    ],
  });
  const live = createBoardLayout();
  live.reset(state.board, state.tiles);

  // Выкладываем красный 1-2-3 с руки: он встаёт в КОНЕЦ рядов (после синего и оранжевого).
  live.push();
  G.moveTiles(state, [R(1), R(2), R(3)], -1);
  const beforeReload = live.sync(state.board, state.tiles);
  assert.deepEqual(meldsOf(beforeReload.runs), [
    [B(7), B(8), B(9)],
    [O(4), O(5), O(6)],
    [R(1), R(2), R(3)],
  ]);

  // 1. Восстановление через rebuildFromState (без кэша раскладки).
  const rebuilt = createBoardLayout();
  const afterRebuild = rebuilt.rebuildFromState(state);
  assert.deepEqual(meldsOf(afterRebuild.runs), meldsOf(beforeReload.runs));

  // 2. Восстановление через serialize/restore.
  const restored = createBoardLayout();
  assert.equal(restored.restore(JSON.parse(JSON.stringify(live.serialize()))), true);
  const afterRestore = restored.sync(state.board, state.tiles);
  assert.deepEqual(meldsOf(afterRestore.runs), meldsOf(beforeReload.runs));

  // Первый undo после загрузки корректно возвращает исходный стол и раскладку.
  assert.equal(G.undo(state), true);
  assert.equal(rebuilt.pop(), true);
  const afterUndo = rebuilt.sync(state.board, state.tiles);
  assert.deepEqual(meldsOf(afterUndo.runs), [
    [B(7), B(8), B(9)],
    [O(4), O(5), O(6)],
  ]);
});

test('sync идемпотентен при повторных вызовах без изменений стола', () => {
  const state = setup({
    racks: [[R(2), B(2), K(2)], [K(1)]],
    board: [[R(9), B(9), O(9)]],
  });
  const layout = createBoardLayout();
  layout.reset(state.board, state.tiles);

  G.moveTiles(state, [R(2), B(2), K(2)], -1);
  const first = layout.sync(state.board, state.tiles);
  const second = layout.sync(state.board, state.tiles);
  assert.deepEqual(meldsOf(first.groups), meldsOf(second.groups));
  assert.deepEqual(meldsOf(first.groups), [
    [R(9), B(9), O(9)],
    [R(2), B(2), K(2)],
  ]);
});
