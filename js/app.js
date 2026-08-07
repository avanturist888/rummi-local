/**
 * Интерфейс игры: экраны, выделение фишек, кнопки.
 * Управление рассчитано на палец: «нажал фишку — нажал набор».
 */

import * as G from './game.js';
import { COLORS, MIN_FIRST_MELD } from './rules.js';
import { findHint } from './hint.js';

const SAVE_KEY = 'rummikub:save:v3';
const NAMES_KEY = 'rummikub:names';

const $ = (id) => document.getElementById(id);

const el = {
  screenSetup: $('screenSetup'),
  screenGame: $('screenGame'),
  countPicker: $('countPicker'),
  nameInputs: $('nameInputs'),
  btnStart: $('btnStart'),
  btnContinue: $('btnContinue'),
  hudName: $('hudName'),
  hudSub: $('hudSub'),
  hudPool: $('hudPool'),
  board: $('board'),
  rack: $('rack'),
  rackCount: $('rackCount'),
  btnSort: $('btnSort'),
  btnHint: $('btnHint'),
  btnUndo: $('btnUndo'),
  btnToRack: $('btnToRack'),
  btnDraw: $('btnDraw'),
  btnEnd: $('btnEnd'),
  overlayPass: $('overlayPass'),
  passName: $('passName'),
  passInfo: $('passInfo'),
  btnReady: $('btnReady'),
  overlayEnd: $('overlayEnd'),
  endKicker: $('endKicker'),
  endName: $('endName'),
  scoreList: $('scoreList'),
  btnNewGame: $('btnNewGame'),
  overlayMenu: $('overlayMenu'),
  overlayRules: $('overlayRules'),
  toast: $('toast'),
};

let state = null;
let selection = new Set();
let hintIds = new Set();
let sortMode = 'run';
let playerCount = 3;
let toastTimer = null;

/* ---------- вспомогательное ---------- */

function toast(text, bad = false) {
  clearTimeout(toastTimer);
  el.toast.textContent = text;
  el.toast.classList.toggle('is-bad', bad);
  el.toast.hidden = false;
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, bad ? 3200 : 2200);
  if (bad) buzz(30);
}

function buzz(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch { /* приватный режим — играем без сохранения */ }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.version !== G.STATE_VERSION || data.phase === 'over') return null;
    return data;
  } catch {
    return null;
  }
}

/** Фишки, которые текущий игрок выложил на стол в этом ходу. */
function freshOnBoard() {
  if (!state || state.phase !== 'play') return new Set();
  const start = JSON.parse(state.startSnapshot);
  const before = new Set(start.board.flat());
  return new Set(state.board.flat().filter((id) => !before.has(id)));
}

/** Фишки, лежавшие на столе к началу хода: их нельзя брать на руку. */
function lockedOnBoard() {
  if (!state) return new Set();
  return new Set(JSON.parse(state.startSnapshot).board.flat());
}

/* ---------- экран настройки ---------- */

function renderNameInputs() {
  const saved = JSON.parse(localStorage.getItem(NAMES_KEY) || '[]');
  const previous = [...el.nameInputs.querySelectorAll('input')].map((i) => i.value);
  el.nameInputs.innerHTML = '';
  for (let i = 0; i < playerCount; i++) {
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 14;
    input.placeholder = `Игрок ${i + 1}`;
    input.value = previous[i] ?? saved[i] ?? '';
    input.autocomplete = 'off';
    el.nameInputs.appendChild(input);
  }
}

function showSetup() {
  state = null;
  selection.clear();
  el.screenGame.hidden = true;
  el.screenSetup.hidden = false;
  el.overlayPass.hidden = true;
  el.overlayEnd.hidden = true;
  el.overlayMenu.hidden = true;
  el.btnContinue.hidden = !loadSave();
  renderNameInputs();
}

function startGame() {
  const names = [...el.nameInputs.querySelectorAll('input')].map(
    (input, i) => input.value.trim() || `Игрок ${i + 1}`
  );
  localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  state = G.newGame(names);
  for (const player of state.players) player.rack = sortRack(player.rack);
  state.startSnapshot = G.snapshot(state);
  enterGame();
}

function enterGame() {
  selection.clear();
  hintIds.clear();
  el.screenSetup.hidden = true;
  el.screenGame.hidden = false;
  el.overlayEnd.hidden = true;
  save();
  render();
}

/* ---------- отрисовка ---------- */

function render() {
  if (!state) return;

  if (state.phase === 'over') {
    renderEnd();
    return;
  }

  const player = G.currentPlayer(state);
  el.hudName.textContent = player.name;
  el.hudSub.textContent = player.melded
    ? `Круг ${state.round} · на руке ${player.rack.length}`
    : `Круг ${state.round} · первый выход от ${MIN_FIRST_MELD} очков`;
  el.hudPool.textContent = `Мешок ${state.pool.length}`;
  el.btnSort.textContent = sortMode === 'run' ? '⇅ цвет' : '⇅ число';

  renderBoard();
  renderRack();

  const busy = state.phase !== 'play';
  el.btnUndo.disabled = busy || state.history.length === 0;
  el.btnToRack.disabled = busy || selection.size === 0;
  el.btnDraw.disabled = busy;
  el.btnEnd.disabled = busy;
  el.btnHint.disabled = busy;
  el.btnSort.disabled = busy;
  el.btnDraw.textContent = state.pool.length ? 'Взять фишку' : 'Пропустить';

  el.overlayPass.hidden = state.phase !== 'pass';
  if (state.phase === 'pass') {
    el.passName.textContent = player.name;
    el.passInfo.textContent = player.melded
      ? `На руке ${player.rack.length} фишек. Нажмите, когда никто не подглядывает.`
      : `На руке ${player.rack.length} фишек. Для первого выхода нужно ${MIN_FIRST_MELD} очков.`;
  }
}

function tileNode(tile, shownValue) {
  const node = document.createElement('div');
  const classes = ['tile', `c-${tile.color}`];
  if (tile.joker) classes.push('is-joker');
  if (selection.has(tile.id)) classes.push('is-sel');
  if (hintIds.has(tile.id)) classes.push('is-hint');
  node.dataset.id = tile.id;
  node.textContent = tile.joker ? '★' : String(tile.num);
  if (tile.joker && shownValue) {
    const ghost = document.createElement('span');
    ghost.className = 'ghost';
    ghost.textContent = shownValue;
    node.appendChild(ghost);
  }
  node.className = classes.join(' ');
  return node;
}

function renderBoard() {
  const fresh = freshOnBoard();
  el.board.innerHTML = '';

  if (!state.board.length) {
    const note = document.createElement('p');
    note.className = 'board-empty';
    note.innerHTML =
      'Стол пуст.<br>Выберите фишки внизу и нажмите <b>＋ Новый набор</b>.';
    el.board.appendChild(note);
  }

  state.board.forEach((meld, index) => {
    const info = G.meldInfo(state, meld);
    const row = document.createElement('div');
    row.className = 'meld' + (info.valid ? '' : ' is-bad');
    row.dataset.index = String(index);

    const drop = document.createElement('button');
    drop.className = 'meld-drop' + (selection.size ? ' is-armed' : '');
    drop.dataset.drop = String(index);
    drop.textContent = selection.size ? '＋' : String(index + 1);
    drop.setAttribute('aria-label', `Положить в набор ${index + 1}`);
    row.appendChild(drop);

    const shown = info.valid ? info.ordered : meld.map((id) => state.tiles[id]);
    shown.forEach((tile, i) => {
      const node = tileNode(tile, info.valid ? info.values[i] : null);
      if (fresh.has(tile.id)) node.classList.add('is-new');
      row.appendChild(node);
    });

    if (!info.valid) {
      const note = document.createElement('span');
      note.className = 'meld-note';
      note.textContent = info.reason;
      row.appendChild(note);
    }
    el.board.appendChild(row);
  });

  const zone = document.createElement('button');
  zone.className = 'new-zone' + (selection.size ? ' is-armed' : '');
  zone.id = 'newZone';
  zone.textContent = selection.size ? `＋ Новый набор (${selection.size})` : '＋ Новый набор';
  el.board.appendChild(zone);
}

function sortRack(ids) {
  const tiles = G.tilesOf(state, ids);
  const key = (t) =>
    sortMode === 'run'
      ? [t.joker ? 1 : 0, COLORS.indexOf(t.color), t.num]
      : [t.joker ? 1 : 0, t.num, COLORS.indexOf(t.color)];
  return tiles
    .slice()
    .sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return 0;
    })
    .map((t) => t.id);
}

function renderRack() {
  const player = G.currentPlayer(state);
  el.rack.innerHTML = '';
  el.rackCount.textContent = String(player.rack.length);

  if (state.phase !== 'play') return;

  if (!player.rack.length) {
    const note = document.createElement('p');
    note.className = 'rack-empty';
    note.textContent = 'Фишек не осталось — нажмите «Ход сделан».';
    el.rack.appendChild(note);
    return;
  }

  for (const tile of G.tilesOf(state, player.rack)) {
    el.rack.appendChild(tileNode(tile, null));
  }
}

function renderEnd() {
  const winner = state.players[state.winner];
  el.overlayPass.hidden = true;
  el.toast.hidden = true;
  clearTimeout(toastTimer);
  el.endKicker.textContent = state.blocked ? 'Ходов больше нет' : 'Все фишки выложены';
  el.endName.textContent = `${winner.name} побеждает`;
  el.scoreList.innerHTML = '';
  state.players.forEach((player, i) => {
    const li = document.createElement('li');
    if (i === state.winner) li.classList.add('is-winner');
    const name = document.createElement('span');
    name.textContent = player.name;
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = player.score > 0 ? `+${player.score}` : String(player.score);
    li.append(name, pts);
    el.scoreList.appendChild(li);
  });
  el.overlayEnd.hidden = false;
}

/* ---------- действия ---------- */

function toggleTile(id) {
  if (state.phase !== 'play') return;
  if (selection.has(id)) selection.delete(id);
  else selection.add(id);
  hintIds.clear();
  render();
}

function selectMeld(index) {
  state.board[index].forEach((id) => selection.add(id));
  render();
}

function placeSelection(meldIndex) {
  if (!selection.size) return;
  const ids = [...selection];
  G.moveTiles(state, ids, meldIndex);
  selection.clear();
  hintIds.clear();
  buzz(8);
  save();
  render();
}

function toRack() {
  const locked = lockedOnBoard();
  const ids = [...selection];
  if (ids.some((id) => locked.has(id))) {
    toast('Фишки, которые уже лежали на столе, забирать на руку нельзя.', true);
    return;
  }
  G.returnToRack(state, ids);
  selection.clear();
  save();
  render();
}

function doHint() {
  const hint = findHint(state, G.tilesOf, G.currentPlayer(state));
  hintIds = new Set(hint.tiles);
  selection.clear();
  toast(hint.text, !hint.found);
  render();
}

function endTurn() {
  const result = G.endTurn(state);
  if (!result.ok) {
    toast(result.error, true);
    return;
  }
  selection.clear();
  hintIds.clear();
  save();
  buzz(14);
  render();
}

function drawTile() {
  const hadChanges = state.history.length > 0;
  const result = G.drawAndPass(state);
  selection.clear();
  hintIds.clear();
  save();
  render();
  if (hadChanges) toast('Перестановки отменены, ход передан дальше.');
}

/* ---------- события ---------- */

el.countPicker.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-count]');
  if (!btn) return;
  playerCount = Number(btn.dataset.count);
  [...el.countPicker.children].forEach((c) => c.classList.toggle('is-active', c === btn));
  renderNameInputs();
});

el.btnStart.addEventListener('click', startGame);

el.btnContinue.addEventListener('click', () => {
  const data = loadSave();
  if (!data) {
    toast('Сохранённая партия не найдена.', true);
    return;
  }
  state = data;
  enterGame();
});

el.board.addEventListener('click', (e) => {
  if (state?.phase !== 'play') return;

  const drop = e.target.closest('[data-drop]');
  if (drop) {
    const index = Number(drop.dataset.drop);
    if (selection.size) placeSelection(index);
    else selectMeld(index);
    return;
  }

  if (e.target.closest('#newZone')) {
    if (selection.size) placeSelection(-1);
    else toast('Сначала выберите фишки — нажмите на них.');
    return;
  }

  const tile = e.target.closest('.tile');
  if (tile) {
    toggleTile(tile.dataset.id);
    return;
  }

  const meld = e.target.closest('.meld');
  if (meld) {
    if (selection.size) placeSelection(Number(meld.dataset.index));
    else selectMeld(Number(meld.dataset.index));
    return;
  }

  // Пустое место на столе — сброс выделения.
  if (selection.size) {
    selection.clear();
    render();
  }
});

el.rack.addEventListener('click', (e) => {
  const tile = e.target.closest('.tile');
  if (tile) toggleTile(tile.dataset.id);
});

el.btnSort.addEventListener('click', () => {
  sortMode = sortMode === 'run' ? 'group' : 'run';
  const player = G.currentPlayer(state);
  player.rack = sortRack(player.rack);
  save();
  render();
});

el.btnHint.addEventListener('click', doHint);

el.btnUndo.addEventListener('click', () => {
  if (G.undo(state)) {
    selection.clear();
    save();
    render();
  }
});

el.btnToRack.addEventListener('click', toRack);
el.btnDraw.addEventListener('click', drawTile);
el.btnEnd.addEventListener('click', endTurn);

el.btnReady.addEventListener('click', () => {
  G.beginTurn(state);
  save();
  render();
});

el.btnNewGame.addEventListener('click', () => {
  localStorage.removeItem(SAVE_KEY);
  showSetup();
});

$('btnMenu').addEventListener('click', () => { el.overlayMenu.hidden = false; });
$('btnCloseMenu').addEventListener('click', () => { el.overlayMenu.hidden = true; });

$('btnResetTurn').addEventListener('click', () => {
  G.resetTurn(state);
  selection.clear();
  hintIds.clear();
  el.overlayMenu.hidden = true;
  save();
  render();
  toast('Ход отменён — стол как в начале хода.');
});

$('btnQuit').addEventListener('click', () => {
  el.overlayMenu.hidden = true;
  if (confirm('Выйти в начало? Партия останется сохранённой.')) showSetup();
});

const openRules = () => { el.overlayRules.hidden = false; };
$('btnRulesSetup').addEventListener('click', openRules);
$('btnRulesGame').addEventListener('click', () => {
  el.overlayMenu.hidden = true;
  openRules();
});
$('btnCloseRules').addEventListener('click', () => { el.overlayRules.hidden = true; });

/* ---------- запуск ---------- */

showSetup();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
