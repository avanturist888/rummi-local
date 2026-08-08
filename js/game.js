/**
 * Состояние партии и правила хода.
 * Стол и руки хранят id фишек; сами фишки лежат в `state.tiles`.
 */

import {
  createDeck,
  analyze,
  handValue,
  RACK_SIZE,
  MIN_FIRST_MELD,
} from './rules.js';

export const STATE_VERSION = 5;

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newGame(names, opts = {}) {
  const deck = shuffle(createDeck());
  const tiles = {};
  for (const t of deck) tiles[t.id] = t;

  const players = names.map((name) => ({
    name: name.trim() || 'Игрок',
    rack: [],
    melded: false,
    score: 0,
    passed: false,
    // Каким игрок видел стол в конце своего последнего хода —
    // всё, чего здесь нет, для него новое.
    seen: [],
    // Сколько фишек было у каждого, когда этот игрок в последний раз
    // держал устройство, — для «Аня — 8 фишек (+2)».
    seenRacks: names.map(() => RACK_SIZE),
    // Фишки, взятые из мешка в прошлый ход, — подсветить на руке.
    drawn: [],
    // Сколько раз автопропуск взял фишку за игрока с его прошлого хода.
    autoDrawn: 0,
  }));

  const pool = deck.map((t) => t.id);
  for (const player of players) {
    player.rack = pool.splice(0, RACK_SIZE);
  }

  const state = {
    version: STATE_VERSION,
    autoSkip: opts.autoSkip !== false,
    tiles,
    players,
    pool,
    board: [],
    turn: 0,
    round: 1,
    phase: 'pass', // pass | play | over
    drew: false,
    winner: null,
    history: [],
    startSnapshot: null,
  };
  state.startSnapshot = snapshot(state);
  return state;
}

/* ---------- доступ к фишкам ---------- */

export const tilesOf = (state, ids) => ids.map((id) => state.tiles[id]);
export const currentPlayer = (state) => state.players[state.turn];

export function meldInfo(state, meld) {
  return analyze(tilesOf(state, meld));
}

/** Короткое имя набора для сообщений: «7·7·8» или «4·★·6». */
export function meldLabel(state, meld) {
  return tilesOf(state, meld)
    .map((t) => (t.joker ? '★' : t.num))
    .join('·');
}

/* ---------- снимки для отмены ---------- */

export function snapshot(state) {
  return JSON.stringify({
    board: state.board,
    racks: state.players.map((p) => p.rack),
    pool: state.pool,
    drew: state.drew,
  });
}

export function restore(state, snap) {
  const data = JSON.parse(snap);
  state.board = data.board;
  state.pool = data.pool;
  state.drew = data.drew;
  data.racks.forEach((rack, i) => {
    state.players[i].rack = rack;
  });
}

export function pushHistory(state) {
  state.history.push(snapshot(state));
  if (state.history.length > 200) state.history.shift();
}

export function undo(state) {
  const snap = state.history.pop();
  if (!snap) return false;
  restore(state, snap);
  return true;
}

export function resetTurn(state) {
  restore(state, state.startSnapshot);
  state.history = [];
}

/* ---------- перемещение фишек ---------- */

/** Снимает фишки отовсюду, не сдвигая индексы наборов на столе. */
function detach(state, ids) {
  const set = new Set(ids);
  for (const player of state.players) {
    player.rack = player.rack.filter((id) => !set.has(id));
  }
  state.board = state.board.map((meld) => meld.filter((id) => !set.has(id)));
}

function cleanBoard(state) {
  state.board = state.board.filter((meld) => meld.length > 0);
}

/** Кладёт выбранные фишки в набор с индексом `meldIndex` (или в новый при -1). */
export function moveTiles(state, ids, meldIndex) {
  if (!ids.length) return;
  pushHistory(state);

  detach(state, ids);

  if (meldIndex >= 0 && meldIndex < state.board.length) {
    state.board[meldIndex] = [...state.board[meldIndex], ...ids];
  } else {
    state.board.push(ids.slice());
  }

  cleanBoard(state);
}

/** Возвращает фишки на руку текущего игрока. */
export function returnToRack(state, ids) {
  if (!ids.length) return;
  pushHistory(state);
  detach(state, ids);
  currentPlayer(state).rack.push(...ids);
  cleanBoard(state);
}

/** Раскладывает набор в правильном порядке (для показа и для аккуратности стола). */
export function tidyBoard(state) {
  state.board = state.board.map((meld) => {
    const info = analyze(tilesOf(state, meld));
    return info.valid ? info.ordered.map((t) => t.id) : meld;
  });
}

/* ---------- проверка хода ---------- */

const meldKey = (meld) => meld.slice().sort().join(',');

function boardCounts(board) {
  const counts = new Map();
  for (const meld of board) {
    const key = meldKey(meld);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function boardTileIds(board) {
  return new Set(board.flat());
}

/**
 * Проверяет, можно ли завершить ход.
 * Возвращает { ok, error, played, points, newMelds }.
 */
export function validateTurn(state) {
  const start = JSON.parse(state.startSnapshot);
  const player = currentPlayer(state);

  const broken = state.board.findIndex((meld) => !analyze(tilesOf(state, meld)).valid);
  if (broken >= 0) {
    const info = analyze(tilesOf(state, state.board[broken]));
    const label = meldLabel(state, state.board[broken]);
    return { ok: false, error: `Набор «${label}» собран неверно: ${info.reason}.` };
  }

  // Фишки со стола нельзя забирать на руку.
  const nowOnBoard = boardTileIds(state.board);
  const missing = [...boardTileIds(start.board)].filter((id) => !nowOnBoard.has(id));
  if (missing.length) {
    return { ok: false, error: 'Фишки со стола нельзя забирать на руку.' };
  }

  const startRack = new Set(start.racks[state.turn]);
  const played = [...nowOnBoard].filter((id) => startRack.has(id));

  if (!played.length) {
    return { ok: false, error: 'Нужно выложить хотя бы одну фишку — или взять фишку из мешка.' };
  }

  const startCounts = boardCounts(start.board);
  const newMelds = [];
  const nowCounts = boardCounts(state.board);
  for (const [key, count] of nowCounts) {
    const before = startCounts.get(key) || 0;
    for (let i = 0; i < count - before; i++) newMelds.push(key.split(',').filter(Boolean));
  }

  if (!player.melded) {
    // До первого выхода стол трогать нельзя: только свои новые наборы.
    const untouched = [...startCounts].every(
      ([key, count]) => (nowCounts.get(key) || 0) >= count
    );
    if (!untouched) {
      return {
        ok: false,
        error: 'До первого выхода нельзя перестраивать наборы на столе.',
      };
    }

    const points = newMelds.reduce(
      (sum, meld) => sum + analyze(tilesOf(state, meld)).points,
      0
    );
    if (points < MIN_FIRST_MELD) {
      return {
        ok: false,
        error: `Для первого выхода нужно ${MIN_FIRST_MELD} очков, а собрано ${points}.`,
      };
    }
    return { ok: true, played, points, newMelds, firstMeld: true };
  }

  return { ok: true, played, points: 0, newMelds, firstMeld: false };
}

/* ---------- завершение хода ---------- */

export function endTurn(state) {
  const check = validateTurn(state);
  if (!check.ok) return check;

  const player = currentPlayer(state);
  if (check.firstMeld) player.melded = true;
  player.passed = false;
  player.drawn = [];

  tidyBoard(state);

  if (player.rack.length === 0) {
    finish(state, state.turn);
    return { ok: true, finished: true };
  }

  nextTurn(state);
  return { ok: true, finished: false };
}

/**
 * Берёт фишку из мешка и передаёт ход. Ход при этом откатывается к началу.
 * `seen` — игрок реально видел руку в этот ход: прежняя подсветка взятых
 * фишек сбрасывается. Автопропуск передаёт false, и подсветка копится.
 */
export function drawAndPass(state, seen = true) {
  resetTurn(state);
  const player = currentPlayer(state);

  const took = state.pool.length > 0;
  if (seen) player.drawn = [];
  if (took) {
    const id = state.pool.shift();
    player.rack.push(id);
    player.drawn.push(id);
    player.passed = false;
  } else {
    player.passed = true;
    // Мешок пуст и все спасовали подряд — партия окончена.
    if (state.players.every((p) => p.passed)) {
      const values = state.players.map((p) => handValue(tilesOf(state, p.rack)));
      const best = values.indexOf(Math.min(...values));
      finish(state, best, true);
      return { ok: true, finished: true, took: false };
    }
  }

  nextTurn(state);
  return { ok: true, finished: false, took };
}

function nextTurn(state) {
  const leaving = currentPlayer(state);
  leaving.seen = state.board.flat();
  leaving.seenRacks = state.players.map((p) => p.rack.length);
  state.turn = (state.turn + 1) % state.players.length;
  if (state.turn === 0) state.round++;
  state.phase = 'pass';
  state.drew = false;
  state.history = [];
  state.startSnapshot = snapshot(state);
}

function finish(state, winnerIndex, blocked = false) {
  let pot = 0;
  state.players.forEach((player, i) => {
    if (i === winnerIndex) return;
    const value = handValue(tilesOf(state, player.rack));
    player.score = -value;
    pot += value;
  });
  state.players[winnerIndex].score = pot;
  state.winner = winnerIndex;
  state.blocked = blocked;
  state.phase = 'over';
}

/** Игрок увидел свои фишки — начинаем ход. */
export function beginTurn(state) {
  state.phase = 'play';
  state.history = [];
  state.startSnapshot = snapshot(state);
}

/**
 * Выравнивание раздачи: сразу после раздачи, до первого хода, каждый,
 * у кого не собирается первый выход, по кругу добирает фишки, пока выход
 * не появится у всех (или не кончится мешок). Игра начинается для всех
 * одновременно — никто не ждёт, пока его «догонит» автопропуск.
 *
 * Добор — вынужденный ход (другого легального нет), порядок по кругу
 * сохранён, а возможность выхода зависит только от своей руки, поэтому
 * партия эквивалентна сыгранной вручную.
 *
 * Возвращает, сколько фишек добрал каждый игрок.
 */
export function resolveOpenings(state, solve) {
  const drew = state.players.map(() => 0);
  let progress = true;
  let guard = 0;
  while (progress && state.pool.length && guard++ < 300) {
    progress = false;
    for (const player of state.players) {
      if (!state.pool.length) break;
      if (player.melded) continue;
      const res = solve(tilesOf(state, player.rack));
      if (res.capped || res.reachedTarget) continue;
      const id = state.pool.shift();
      player.rack.push(id);
      player.drawn.push(id);
      player.autoDrawn += 1;
      drew[state.players.indexOf(player)] += 1;
      progress = true;
    }
  }
  return drew;
}

/**
 * Автопропуск вынужденных ходов посреди партии: пока очередной игрок
 * не вышел и из его руки в принципе не собрать первый выход, единственный
 * легальный ход — взять фишку. Игра делает его сама, не требуя
 * передавать устройство.
 *
 * `solve(tiles)` — решатель первого выхода ({ reachedTarget, capped }).
 * Правила не меняются: партия развивается ровно так же, как если бы
 * игрок сам нажал «Взять фишку».
 */
export function autoSkipImpossible(state, solve) {
  let skipped = 0;
  let guard = 0;
  while (state.phase === 'pass' && guard++ < 300) {
    const player = currentPlayer(state);
    if (player.melded) break;
    const res = solve(tilesOf(state, player.rack));
    if (res.capped || res.reachedTarget) break;

    beginTurn(state);
    const took = state.pool.length > 0;
    const result = drawAndPass(state, false);
    if (took) player.autoDrawn += 1;
    skipped++;
    if (result.finished) break;
  }
  return skipped;
}
