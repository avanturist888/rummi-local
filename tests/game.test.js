import test from 'node:test';
import assert from 'node:assert/strict';

import * as G from '../js/game.js';

/** Партия с заданными руками и столом — без случайной раздачи. */
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
  });
  state.pool = Object.keys(state.tiles).filter((id) => !used.has(id));
  G.beginTurn(state);
  return state;
}

// r/b/o/k + число + _0 или _1 (две копии каждой фишки)
const R = (n, c = 0) => `r${n}_${c}`;
const B = (n, c = 0) => `b${n}_${c}`;
const O = (n, c = 0) => `o${n}_${c}`;
const K = (n, c = 0) => `k${n}_${c}`;

test('первый выход меньше 30 очков не принимается', () => {
  const state = setup({ racks: [[R(1), B(1), K(1), R(5)], [O(2)]] });
  G.moveTiles(state, [R(1), B(1), K(1)], -1);

  const check = G.validateTurn(state);
  assert.equal(check.ok, false);
  assert.match(check.error, /30 очков/);
});

test('первый выход на 30+ очков принимается и отмечает игрока', () => {
  const state = setup({ racks: [[R(11), B(11), K(11), R(5)], [O(2)]] });
  G.moveTiles(state, [R(11), B(11), K(11)], -1);

  const result = G.endTurn(state);
  assert.equal(result.ok, true);
  assert.equal(state.players[0].melded, true);
  assert.equal(state.turn, 1);
  assert.equal(state.phase, 'pass');
});

test('ход без единой выложенной фишки не засчитывается', () => {
  const state = setup({ racks: [[R(1)], [B(2)]] });
  const check = G.validateTurn(state);
  assert.equal(check.ok, false);
  assert.match(check.error, /хотя бы одну фишку/);
});

test('неправильный набор на столе блокирует конец хода', () => {
  const state = setup({ racks: [[R(11), B(11), K(11), R(5)], [O(2)]] });
  G.moveTiles(state, [R(11), B(11), K(11), R(5)], -1);

  const check = G.validateTurn(state);
  assert.equal(check.ok, false);
  assert.match(check.error, /собран неверно/);
});

test('до первого выхода нельзя трогать наборы на столе', () => {
  const state = setup({
    racks: [[R(4), R(12), B(12), K(12)], [O(2)]],
    board: [[R(1), R(2), R(3)]],
  });
  state.players[0].melded = false;
  G.moveTiles(state, [R(4)], 0); // подкладываем к чужому ряду
  G.moveTiles(state, [R(12), B(12), K(12)], -1);

  const check = G.validateTurn(state);
  assert.equal(check.ok, false);
  assert.match(check.error, /перестраивать/);
});

test('после выхода можно добавлять фишки к чужим наборам', () => {
  const state = setup({
    racks: [[R(4), O(7)], [B(2)]],
    board: [[R(1), R(2), R(3)]],
  });
  state.players[0].melded = true;
  G.moveTiles(state, [R(4)], 0);

  const check = G.validateTurn(state);
  assert.equal(check.ok, true);
  assert.deepEqual(state.board[0].length, 4);
});

test('фишки со стола нельзя забирать на руку', () => {
  const state = setup({
    racks: [[R(4)], [B(2)]],
    board: [[R(1), R(2), R(3), R(5)]],
  });
  state.players[0].melded = true;
  G.moveTiles(state, [R(4)], 0);
  G.returnToRack(state, [R(5)]);

  const check = G.validateTurn(state);
  assert.equal(check.ok, false);
  assert.match(check.error, /со стола/);
});

test('перестроить стол можно, если все наборы остались правильными', () => {
  const state = setup({
    racks: [[R(4)], [B(2)]],
    board: [
      [R(1), R(2), R(3)],
      [K(9), B(9), O(9)],
    ],
  });
  state.players[0].melded = true;
  G.moveTiles(state, [R(4)], 0);
  G.moveTiles(state, [O(9)], 1); // перекладывание внутрь того же набора ничего не ломает

  const check = G.validateTurn(state);
  assert.equal(check.ok, true);
});

test('выложив последнюю фишку, игрок побеждает и считается счёт', () => {
  const state = setup({ racks: [[R(11), B(11), K(11)], [O(13), K(13)]] });
  G.moveTiles(state, [R(11), B(11), K(11)], -1);

  const result = G.endTurn(state);
  assert.equal(result.finished, true);
  assert.equal(state.phase, 'over');
  assert.equal(state.winner, 0);
  assert.equal(state.players[0].score, 26);
  assert.equal(state.players[1].score, -26);
});

test('взятие фишки отменяет перестановки и передаёт ход', () => {
  const state = setup({ racks: [[R(11), B(11), K(11)], [O(2)]] });
  G.moveTiles(state, [R(11), B(11), K(11)], -1);
  const poolBefore = state.pool.length;

  const result = G.drawAndPass(state);
  assert.equal(result.took, true);
  assert.equal(state.board.length, 0, 'стол вернулся в исходное состояние');
  assert.equal(state.players[0].rack.length, 4);
  assert.equal(state.pool.length, poolBefore - 1);
  assert.equal(state.turn, 1);
});

test('пустой мешок и всеобщий пас заканчивают партию по меньшей руке', () => {
  const state = setup({ racks: [[R(13), K(13)], [O(2)]] });
  state.pool = [];
  G.beginTurn(state); // мешок пуст уже на старте хода

  G.drawAndPass(state); // ход 1 пасует
  assert.equal(state.phase, 'pass');
  G.beginTurn(state);
  const result = G.drawAndPass(state); // ход 2 пасует — партия окончена

  assert.equal(result.finished, true);
  assert.equal(state.winner, 1, 'у второго игрока рука дешевле');
  assert.equal(state.blocked, true);
  assert.equal(state.players[1].score, 26);
});

test('отмена возвращает предыдущий шаг', () => {
  const state = setup({ racks: [[R(11), B(11), K(11)], [O(2)]] });
  G.moveTiles(state, [R(11), B(11)], -1);
  assert.equal(state.board.length, 1);

  assert.equal(G.undo(state), true);
  assert.equal(state.board.length, 0);
  assert.equal(state.players[0].rack.length, 3);
});

test('после хода игрок запоминает стол — сопернику эти фишки видны как новые', () => {
  const state = setup({ racks: [[R(11), B(11), K(11), R(5)], [O(2)]] });
  G.moveTiles(state, [R(11), B(11), K(11)], -1);
  G.endTurn(state);

  assert.deepEqual([...state.players[0].seen].sort(), [B(11), K(11), R(11)].sort());
  assert.deepEqual(state.players[1].seen, [], 'второй игрок стол ещё не видел');
});

test('автопропуск прокручивает вынужденные ходы до игрока с выбором', () => {
  // У первого игрока выхода нет, у второго есть.
  const state = setup({ racks: [[R(1), B(2), K(3)], [R(11), B(11), K(11)]] });
  state.phase = 'pass';
  const poolBefore = state.pool.length;

  const solve = (tiles) => ({
    reachedTarget: tiles.some((t) => t.num === 11),
    capped: false,
  });
  const skipped = G.autoSkipImpossible(state, solve);

  assert.equal(skipped, 1, 'пропущен ровно один ход');
  assert.equal(state.turn, 1, 'ход дошёл до второго игрока');
  assert.equal(state.phase, 'pass');
  assert.equal(state.players[0].rack.length, 4, 'первому автоматически взята фишка');
  assert.equal(state.players[0].autoDrawn, 1);
  assert.equal(state.players[0].drawn.length, 1, 'взятая фишка подсвечена');
  assert.equal(state.pool.length, poolBefore - 1);
});

test('автопропуск не трогает игрока, который уже вышел', () => {
  const state = setup({ racks: [[R(1), B(2)], [O(2)]] });
  state.players[0].melded = true;
  state.phase = 'pass';

  const skipped = G.autoSkipImpossible(state, () => ({ reachedTarget: false, capped: false }));
  assert.equal(skipped, 0);
  assert.equal(state.turn, 0);
});

test('автопропуск при пустом мешке доигрывает блокированную партию', () => {
  const state = setup({ racks: [[R(13), K(13)], [O(2)]] });
  state.pool = [];
  state.phase = 'pass';

  G.autoSkipImpossible(state, () => ({ reachedTarget: false, capped: false }));
  assert.equal(state.phase, 'over', 'оба спасовали — партия окончена');
  assert.equal(state.winner, 1, 'у второго рука дешевле');
});

test('подсветка взятых фишек копится при автопропуске и сбрасывается ходом', () => {
  const state = setup({ racks: [[R(1), B(2)], [R(11), B(11), K(11), O(5)]] });
  state.phase = 'pass';

  // Два круга автопропуска первого игрока.
  const solve = (tiles) => ({ reachedTarget: tiles.some((t) => t.num === 11), capped: false });
  G.autoSkipImpossible(state, solve); // пропуск игрока 1, очередь игрока 2
  G.beginTurn(state);
  G.drawAndPass(state); // игрок 2 берёт фишку сам
  G.autoSkipImpossible(state, solve); // игрок 1 снова пропущен

  assert.equal(state.players[0].drawn.length, 2, 'обе автовзятые фишки подсвечены');
  assert.equal(state.players[0].autoDrawn, 2);

  // А у второго после настоящего взятия подсвечена ровно одна.
  assert.equal(state.players[1].drawn.length, 1);
});

test('на экране передачи видно, как менялись руки: seenRacks пишется при уходе', () => {
  const state = setup({ racks: [[R(11), B(11), K(11), R(5)], [O(2), O(3)]] });
  G.moveTiles(state, [R(11), B(11), K(11)], -1);
  G.endTurn(state);

  assert.deepEqual(state.players[0].seenRacks, [1, 2], 'счётчики зафиксированы после хода');
});

test('tidyBoard раскладывает ряд по порядку', () => {
  const state = setup({ racks: [[B(3), B(1), B(2)], [O(2)]] });
  G.moveTiles(state, [B(3), B(1), B(2)], -1);
  G.tidyBoard(state);
  assert.deepEqual(state.board[0], [B(1), B(2), B(3)]);
});
