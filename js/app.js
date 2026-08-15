/**
 * Интерфейс игры: экраны, выделение фишек, кнопки.
 * Управление рассчитано на палец: «нажал фишку — нажал набор».
 */

import * as G from './game.js';
import { COLORS, MIN_FIRST_MELD, findSets } from './rules.js';
import { bestFirstMeld } from './solver.js';
import { findHint } from './hint.js';

const SAVE_KEY = 'rummikub:save:v5';
const NAMES_KEY = 'rummikub:names';
const AUTOSKIP_KEY = 'rummikub:autoskip';
const SERIES_KEY = 'rummikub:series';
const ROSTER_KEY = 'rummikub:roster';
const TIMER_KEY = 'rummikub:timer';
const PCOLORS_KEY = 'rummikub:playerColors';

/** Палитра игроков: подобрана под тёмно-зелёное сукно интерфейса. */
const PLAYER_COLORS = ['#ffd166', '#7ee0a3', '#ff9d76', '#c9a7ff', '#6fc3ff', '#ff8fb3'];

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
  hudPlayers: $('hudPlayers'),
  hudPool: $('hudPool'),
  board: $('board'),
  rack: $('rack'),
  selPanel: $('selPanel'),
  hudTimer: $('hudTimer'),
  timerPicker: $('timerPicker'),
  btnSort: $('btnSort'),
  sortLabel: $('sortLabel'),
  btnUndo: $('btnUndo'),
  btnToRack: $('btnToRack'),
  btnPlace: $('btnPlace'),
  btnDraw: $('btnDraw'),
  drawLabel: $('drawLabel'),
  btnEnd: $('btnEnd'),
  endLabel: $('endLabel'),
  meldBar: $('meldBar'),
  meldFill: $('meldFill'),
  btnFull: $('btnFull'),
  overlayConfirm: $('overlayConfirm'),
  confirmText: $('confirmText'),
  btnConfirmYes: $('btnConfirmYes'),
  btnConfirmNo: $('btnConfirmNo'),
  overlayPass: $('overlayPass'),
  passName: $('passName'),
  passInfo: $('passInfo'),
  passStats: $('passStats'),
  btnReady: $('btnReady'),
  overlayEnd: $('overlayEnd'),
  endKicker: $('endKicker'),
  endName: $('endName'),
  scoreList: $('scoreList'),
  seriesLine: $('seriesLine'),
  btnSeriesReset: $('btnSeriesReset'),
  btnNewGame: $('btnNewGame'),
  optAutoSkip: $('optAutoSkip'),
  rosterChips: $('rosterChips'),
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
let meldCache = null; // расчёт первого выхода: один раз за ход
let timerSec = 0; // выбранный на экране настройки таймер хода
let playerColorIdx = [0, 1, 2, 3]; // выбранные цвета игроков (индексы палитры)
let confirmResolve = null;
let smartCache = null; // «умная» раскладка лотка: пересчёт только при смене руки
let dimIds = new Set(); // фишки лотка, которые не женятся с выбранными
let mateIds = new Set(); // фишки стола, которые подходят к выбранным

/* ---------- вспомогательное ---------- */

function toast(text, bad = false) {
  clearTimeout(toastTimer);
  el.toast.textContent = text;
  el.toast.classList.toggle('is-bad', bad);
  el.toast.hidden = false;
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, bad ? 3500 : 2400);
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

/** Фишки, появившиеся на столе с прошлого хода текущего игрока (чужие ходы). */
function newSinceLastSeen() {
  if (!state || state.phase === 'over') return new Set();
  const seen = new Set(G.currentPlayer(state).seen || []);
  const fresh = freshOnBoard();
  return new Set(
    state.board.flat().filter((id) => !seen.has(id) && !fresh.has(id))
  );
}

/** Фишки, лежавшие на столе к началу хода: их нельзя брать на руку. */
function lockedOnBoard() {
  if (!state) return new Set();
  return new Set(JSON.parse(state.startSnapshot).board.flat());
}

/**
 * Что светит текущему игроку с первым выходом (null, если уже вышел).
 * Считается от полной руки на начало хода и кэшируется на весь ход.
 */
function firstMeldOutlook() {
  const player = G.currentPlayer(state);
  if (player.melded) return null;
  const rackIds = JSON.parse(state.startSnapshot).racks[state.turn];
  const key = `${state.round}:${state.turn}:${rackIds.length}`;
  if (!meldCache || meldCache.state !== state || meldCache.key !== key) {
    meldCache = { state, key, res: bestFirstMeld(G.tilesOf(state, rackIds), MIN_FIRST_MELD) };
  }
  return meldCache.res;
}

const shortName = (s) => (s.length > 9 ? s.slice(0, 8) + '…' : s);

const playerColor = (player) => player.color || PLAYER_COLORS[0];

/* ---------- стилизованное подтверждение ---------- */

/**
 * Замена системному confirm(): живёт внутри #stage, поэтому
 * поворачивается вместе с игрой и выглядит как остальной интерфейс.
 */
function askConfirm(text, yesLabel = 'Да') {
  el.confirmText.textContent = text;
  el.btnConfirmYes.textContent = yesLabel;
  el.overlayConfirm.hidden = false;
  return new Promise((resolve) => { confirmResolve = resolve; });
}

function closeConfirm(answer) {
  el.overlayConfirm.hidden = true;
  const resolve = confirmResolve;
  confirmResolve = null;
  resolve?.(answer);
}

/* ---------- ориентация ---------- */

/**
 * Игра всегда ландшафтная. Если телефон держат вертикально
 * (например, выключен автоповорот), сцена поворачивается на 90°
 * классом is-rot; сама раскладка включается классом land.
 */
function updateViewportMode() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const portrait = h >= w;
  const phone = Math.min(w, h) < 620;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const rotated = portrait && phone && touch;
  document.body.classList.toggle('is-rot', rotated);
  document.body.classList.toggle('land', rotated || (!portrait && h < 620));
  // Число рядов лотка зависит от ориентации — перерисовываем.
  if (state && !el.screenGame.hidden) render();
}
window.addEventListener('resize', updateViewportMode);
window.addEventListener('orientationchange', updateViewportMode);
updateViewportMode();

/* ---------- экран настройки ---------- */

function loadAutoSkipPref() {
  el.optAutoSkip.checked = localStorage.getItem(AUTOSKIP_KEY) !== '0';
}

function loadTimerPref() {
  timerSec = Number(localStorage.getItem(TIMER_KEY)) || 0;
  const options = [...el.timerPicker.children].map((b) => Number(b.dataset.timer));
  // Сохранённое значение из старого набора вариантов — сбрасываем на «выкл».
  if (!options.includes(timerSec)) timerSec = 0;
  [...el.timerPicker.children].forEach((b) =>
    b.classList.toggle('is-active', Number(b.dataset.timer) === timerSec)
  );
}

function loadColorPref() {
  try {
    const saved = JSON.parse(localStorage.getItem(PCOLORS_KEY)) || [];
    playerColorIdx = [0, 1, 2, 3].map((i) =>
      Number.isInteger(saved[i]) ? saved[i] % PLAYER_COLORS.length : i
    );
  } catch {
    playerColorIdx = [0, 1, 2, 3];
  }
}

function saveColorPref() {
  try { localStorage.setItem(PCOLORS_KEY, JSON.stringify(playerColorIdx)); } catch { /* пусть */ }
}

/* ---------- запомненные игроки ---------- */

function readRoster() {
  try {
    const list = JSON.parse(localStorage.getItem(ROSTER_KEY)) || [];
    return Array.isArray(list) ? list.filter((n) => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

function writeRoster(list) {
  try { localStorage.setItem(ROSTER_KEY, JSON.stringify(list.slice(0, 12))); } catch { /* пусть */ }
}

/** Игроки этой партии встают в начало списка (недавние — первыми). */
function rememberPlayers(names) {
  const seen = new Set(names.map((n) => n.toLowerCase()));
  const rest = readRoster().filter((n) => !seen.has(n.toLowerCase()));
  writeRoster([...names, ...rest]);
}

function renderRoster() {
  const used = new Set(
    [...el.nameInputs.querySelectorAll('input')].map((i) => i.value.trim().toLowerCase())
  );
  const free = readRoster().filter((n) => !used.has(n.toLowerCase()));
  el.rosterChips.hidden = !free.length;
  el.rosterChips.innerHTML = '';
  for (const name of free) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'roster-chip';
    chip.dataset.name = name;
    const label = document.createElement('span');
    label.textContent = name;
    const del = document.createElement('span');
    del.className = 'x';
    del.dataset.del = name;
    del.textContent = '✕';
    del.setAttribute('aria-label', `Забыть игрока ${name}`);
    chip.append(label, del);
    el.rosterChips.appendChild(chip);
  }
}

function renderNameInputs() {
  const saved = JSON.parse(localStorage.getItem(NAMES_KEY) || '[]');
  const previous = [...el.nameInputs.querySelectorAll('input')].map((i) => i.value);
  el.nameInputs.innerHTML = '';
  for (let i = 0; i < playerCount; i++) {
    const row = document.createElement('div');
    row.className = 'name-row';

    // Кружок цвета: тап перебирает свободные цвета палитры.
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'color-dot';
    dot.dataset.player = String(i);
    dot.style.setProperty('--dot', PLAYER_COLORS[playerColorIdx[i]]);
    dot.setAttribute('aria-label', `Цвет игрока ${i + 1}`);

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 14;
    input.placeholder = `Игрок ${i + 1}`;
    input.value = previous[i] ?? saved[i] ?? '';
    input.autocomplete = 'off';

    row.append(dot, input);
    el.nameInputs.appendChild(row);
  }
}

/** Следующий цвет палитры, не занятый другими видимыми игроками. */
function cyclePlayerColor(i) {
  const used = playerColorIdx.filter((_, k) => k !== i && k < playerCount);
  let next = playerColorIdx[i];
  for (let step = 0; step < PLAYER_COLORS.length; step++) {
    next = (next + 1) % PLAYER_COLORS.length;
    if (!used.includes(next)) break;
  }
  playerColorIdx[i] = next;
  saveColorPref();
  const dot = el.nameInputs.querySelector(`.color-dot[data-player="${i}"]`);
  if (dot) dot.style.setProperty('--dot', PLAYER_COLORS[next]);
}

function showSetup() {
  state = null;
  selection.clear();
  document.body.classList.remove('in-game');
  el.screenGame.hidden = true;
  el.screenSetup.hidden = false;
  el.overlayPass.hidden = true;
  el.overlayEnd.hidden = true;
  el.overlayMenu.hidden = true;
  el.btnContinue.hidden = !loadSave();
  loadAutoSkipPref();
  loadTimerPref();
  loadColorPref();
  renderNameInputs();
  renderRoster();
  document.body.style.removeProperty('--pc');
}

function startGame() {
  const names = [...el.nameInputs.querySelectorAll('input')].map(
    (input, i) => input.value.trim() || `Игрок ${i + 1}`
  );
  localStorage.setItem(NAMES_KEY, JSON.stringify(names));
  localStorage.setItem(AUTOSKIP_KEY, el.optAutoSkip.checked ? '1' : '0');
  localStorage.setItem(TIMER_KEY, String(timerSec));
  rememberPlayers(names);
  state = G.newGame(names, { autoSkip: el.optAutoSkip.checked });
  state.timerSec = timerSec;
  state.players.forEach((p, i) => { p.color = PLAYER_COLORS[playerColorIdx[i]]; });
  // Выравнивание раздачи: добираем фишки всем, у кого нет выхода на 30, —
  // игра начинается для всех одновременно.
  let rounds = 0;
  if (state.autoSkip) {
    const drew = G.resolveOpenings(state, (tiles) => bestFirstMeld(tiles, MIN_FIRST_MELD));
    rounds = Math.max(...drew);
  }
  for (const player of state.players) player.rack = sortRack(player.rack);
  state.startSnapshot = G.snapshot(state);
  enterGame();
  if (rounds > 0) {
    toast(`Раздача выровнена: все добрали по ${tilesWord(rounds)} — выход на 30 есть у каждого.`);
  }
}

/** Прокручивает вынужденные ходы, пока не дойдёт до игрока с выбором. */
function runAutoSkip() {
  if (!state.autoSkip || state.phase !== 'pass') return;
  G.autoSkipImpossible(state, (tiles) => bestFirstMeld(tiles, MIN_FIRST_MELD));
}

function enterGame() {
  selection.clear();
  hintIds.clear();
  meldCache = null;
  document.body.classList.add('in-game');
  el.screenSetup.hidden = true;
  el.screenGame.hidden = false;
  el.overlayEnd.hidden = true;
  runAutoSkip();
  // Партию могли открыть заново посреди хода — время отсчитываем заново.
  if (state.phase === 'play') armTurnTimer();
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
  const busy = state.phase !== 'play';
  const outlook = busy ? null : firstMeldOutlook();
  const locked = !!outlook && !outlook.reachedTarget && !outlook.capped;
  // Ход реально можно завершить? Только тогда кнопка хода подсвечена.
  const turnReady = !busy && !locked && G.validateTurn(state).ok;

  document.body.style.setProperty('--pc', playerColor(player));
  el.hudName.textContent = player.name;
  el.hudSub.textContent = subLine(player, outlook, locked);
  el.hudPool.textContent = String(state.pool.length);
  renderHudPlayers();
  updateTimerChip();

  computeMarks(busy, player);

  // Полная перерисовка не должна сбрасывать прокрутку: иначе фишки
  // сдвигаются под пальцем и следующий тап попадает не туда.
  const boardScroll = el.board.scrollTop;
  const rackScroll = el.rack.scrollTop;
  renderBoard(locked, outlook);
  renderRack();
  renderSelPanel();
  el.board.scrollTop = boardScroll;
  el.rack.scrollTop = rackScroll;

  el.btnUndo.disabled = busy || state.history.length === 0;
  el.btnToRack.disabled = busy || selection.size === 0;
  el.btnPlace.disabled = busy || selection.size === 0;
  el.btnDraw.disabled = busy;
  el.btnEnd.disabled = busy || locked;
  el.btnSort.disabled = busy;
  el.sortLabel.textContent = { run: 'цвет', group: 'число', smart: 'умно' }[sortMode];

  // «Выставить» зеленеет, когда выбранное реально ляжет правильным ходом:
  // само по себе валидный набор или целиком подходит к набору на столе.
  const selIds = [...selection];
  const placeReady =
    !busy &&
    selIds.length > 0 &&
    (G.meldInfo(state, selIds).valid ||
      (player.melded &&
        state.board.some(
          (m) => !m.some((id) => selection.has(id)) && G.meldInfo(state, [...m, ...selIds]).valid
        )));
  el.btnPlace.classList.toggle('is-ready', placeReady);
  el.drawLabel.textContent = state.pool.length ? 'Взять фишку' : 'Пропустить';

  // Кнопка хода загорается зелёным только когда ход реально готов;
  // до первого выхода она показывает прогресс до 30 очков.
  const opening = !busy && !player.melded && !locked;
  const points = opening ? playedPoints() : 0;
  el.btnEnd.classList.toggle('is-ready', turnReady);
  el.endLabel.textContent = turnReady
    ? (opening ? `✓ Выйти: ${points} очк.` : '✓ Завершить ход')
    : (opening ? `Выход: ${points} / ${MIN_FIRST_MELD}` : 'Завершить ход');
  el.meldBar.hidden = !opening || turnReady;
  if (!el.meldBar.hidden) {
    el.meldFill.style.width = `${Math.min(100, (points / MIN_FIRST_MELD) * 100)}%`;
  }

  // Когда выйти нельзя, единственный осмысленный ход — взять фишку.
  el.btnDraw.classList.toggle('is-urge', locked);

  el.overlayPass.hidden = state.phase !== 'pass';
  if (state.phase === 'pass') renderPass(player);
}

/** Очки в новых наборах этого хода (до выхода все новые наборы — только свои). */
function playedPoints() {
  const fresh = freshOnBoard();
  let sum = 0;
  for (const meld of state.board) {
    if (!meld.length || !meld.every((id) => fresh.has(id))) continue;
    const info = G.meldInfo(state, meld);
    if (info.valid) sum += info.points;
  }
  return sum;
}

function subLine(player, outlook, locked) {
  const base = `Круг ${state.round} · на руке ${player.rack.length}`;
  if (player.melded) return base;
  if (locked) return `${base} · выход пока невозможен`;
  if (outlook?.reachedTarget) return `${base} · выход есть: ${outlook.points} очк.`;
  return `${base} · выход от ${MIN_FIRST_MELD} очк.`;
}

function renderHudPlayers() {
  el.hudPlayers.innerHTML = '';
  state.players.forEach((p, i) => {
    const chip = document.createElement('span');
    chip.className = 'pchip' + (i === state.turn ? ' is-turn' : '');
    chip.style.setProperty('--pcc', playerColor(p));
    const dot = document.createElement('span');
    dot.className = 'pdot';
    chip.append(dot, shortName(p.name) + ' ');
    const count = document.createElement('b');
    count.textContent = String(p.rack.length);
    chip.appendChild(count);
    el.hudPlayers.appendChild(chip);
  });
}

function renderPass(player) {
  const news = newSinceLastSeen();
  el.passName.textContent = player.name;
  el.passName.style.color = playerColor(player);
  // Кнопка «Я готов» — цвета игрока, который должен её нажать.
  el.btnReady.style.background = playerColor(player);
  el.btnReady.style.color = '#1c1508';
  el.passInfo.textContent =
    (player.autoDrawn > 0
      ? `Вы автоматически добрали ${tilesWord(player.autoDrawn)} — они подсвечены на руке. `
      : '') +
    (news.size
      ? `С вашего прошлого хода на столе ${tilesWord(news.size)} — они подсвечены голубым. `
      : '') +
    (player.melded ? '' : `Для первого выхода нужно ${MIN_FIRST_MELD} очков. `) +
    'Нажмите, когда никто не подглядывает.';

  el.passStats.innerHTML = '';
  state.players.forEach((p, i) => {
    const li = document.createElement('li');
    if (i === state.turn) li.classList.add('is-turn');
    const name = document.createElement('span');
    name.textContent = (i === state.turn ? '▸ ' : '') + p.name;
    const info = document.createElement('span');
    info.className = 'pts';
    // Сколько фишек стало и как изменилось с прошлого хода смотрящего.
    const delta = p.rack.length - player.seenRacks[i];
    const deltaText =
      delta === 0 ? '' : delta > 0 ? ` (+${delta})` : ` (−${-delta})`;
    info.textContent = `${tilesWord(p.rack.length)}${deltaText}${p.melded ? '' : ' · не вышел'}`;
    li.append(name, info);
    el.passStats.appendChild(li);
  });
}

function tilesWord(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} фишка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} фишки`;
  return `${n} фишек`;
}

function tileNode(tile, shownValue, fresh, news) {
  const node = document.createElement('div');
  const classes = ['tile', `c-${tile.color}`];
  if (tile.joker) classes.push('is-joker');
  if (fresh?.has(tile.id)) classes.push('is-you');
  else if (news?.has(tile.id)) classes.push('is-them');
  if (selection.has(tile.id)) classes.push('is-sel');
  if (hintIds.has(tile.id)) classes.push('is-hint');
  if (dimIds.has(tile.id)) classes.push('is-dim');
  if (mateIds.has(tile.id)) classes.push('is-mate');
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

function meldRow(entry, fresh, news, canTake) {
  const { meld, index, info } = entry;
  const row = document.createElement('div');
  row.className = 'meld' + (info.valid ? '' : ' is-bad');
  if (meld.some((id) => news.has(id))) row.classList.add('has-new');
  // Выбранные фишки складываются с этим набором — подсказываем куда нажать.
  if (canTake?.has(index)) row.classList.add('can-take');
  row.dataset.index = String(index);

  const shown = info.valid ? info.ordered : meld.map((id) => state.tiles[id]);
  shown.forEach((tile, i) => {
    row.appendChild(tileNode(tile, info.valid ? info.values[i] : null, fresh, news));
  });

  // Свободная ячейка «＋» в конце набора: в неё удобно попадать пальцем,
  // тап кладёт выбранные фишки в этот набор. Полному набору она не нужна.
  const full =
    info.valid && ((info.type === 'group' && meld.length >= 4) || meld.length >= 13);
  if (state.phase === 'play' && !full) {
    const slot = document.createElement('button');
    slot.className = 'slot-add' + (canTake?.has(index) ? ' is-hot' : '');
    slot.textContent = '＋';
    slot.setAttribute('aria-label', 'Положить выбранные фишки в этот набор');
    row.appendChild(slot);
  }

  if (!info.valid) {
    const note = document.createElement('span');
    note.className = 'meld-note';
    note.textContent = info.reason;
    row.appendChild(note);
  }
  return row;
}

function renderBoard(locked, outlook) {
  const fresh = freshOnBoard();
  // Чужие новинки подсвечены, только пока игрок сам ничего не трогал:
  // как только начались перестановки, метки гаснут и не путаются под руками.
  const news = state.history.length ? new Set() : newSinceLastSeen();
  const lockedIds = lockedOnBoard();
  el.board.innerHTML = '';

  if (locked) {
    const note = document.createElement('div');
    note.className = 'lock-note';
    note.textContent =
      outlook.points > 0
        ? `Первый выход не собирается: из этой руки выходит максимум ${outlook.points} очк., а нужно ${MIN_FIRST_MELD}. Возьмите фишку.`
        : 'Из этой руки не собрать ни одного набора. Возьмите фишку.';
    el.board.appendChild(note);
  }

  if (!state.board.length) {
    const note = document.createElement('p');
    note.className = 'board-empty';
    note.innerHTML =
      'Стол пуст.<br>Выберите фишки внизу и нажмите <b>Выставить</b>.';
    el.board.appendChild(note);
    return;
  }

  if (fresh.size || news.size) {
    const legend = document.createElement('div');
    legend.className = 'legend';
    if (fresh.size) {
      const you = document.createElement('span');
      you.className = 'lg lg-you';
      you.textContent = 'ваши за этот ход';
      legend.appendChild(you);
    }
    if (news.size) {
      const them = document.createElement('span');
      them.className = 'lg lg-them';
      them.textContent = 'новые с вашего прошлого хода';
      legend.appendChild(them);
    }
    el.board.appendChild(legend);
  }

  const entries = state.board.map((meld, index) => ({
    meld,
    index,
    info: G.meldInfo(state, meld),
  }));

  // К каким наборам выбранные фишки подходят целиком. До первого выхода
  // достраивать можно только собственные новые наборы.
  const player = G.currentPlayer(state);
  const canTake = new Set();
  if (selection.size) {
    const selIds = [...selection];
    for (const entry of entries) {
      if (entry.meld.some((id) => selection.has(id))) continue;
      if (!player.melded && entry.meld.some((id) => lockedIds.has(id))) continue;
      if (G.meldInfo(state, [...entry.meld, ...selIds]).valid) canTake.add(entry.index);
    }
  }

  // Разобранный набор остаётся на своём месте в своей колонке и просто
  // подсвечивается красным — не улетает в начало стола. Колонку выбираем
  // по оставшимся фишкам: одинаковые числа — к группам, один цвет — к рядам.
  const naturalsOf = (e) => G.tilesOf(state, e.meld).filter((t) => !t.joker);
  for (const e of entries) {
    if (e.info.valid) {
      e.zone = e.info.type;
      e.key =
        e.info.type === 'group'
          ? [e.info.values[0], 0]
          : [
              COLORS.indexOf(e.info.ordered.find((t) => !t.joker).color),
              e.info.values[0],
            ];
      continue;
    }
    const n = naturalsOf(e);
    if (n.length && n.every((t) => t.num === n[0].num)) {
      e.zone = 'group';
      e.key = [n[0].num, 0];
    } else if (n.length && n.every((t) => t.color === n[0].color)) {
      e.zone = 'run';
      e.key = [COLORS.indexOf(n[0].color), Math.min(...n.map((t) => t.num))];
    } else {
      e.zone = 'repair';
    }
  }
  const byKey = (a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1];
  const groups = entries.filter((e) => e.zone === 'group').sort(byKey);
  const runs = entries.filter((e) => e.zone === 'run').sort(byKey);

  // Совсем разнобойная кучка (редкость) — чинить сверху на всю ширину.
  for (const entry of entries.filter((e) => e.zone === 'repair')) {
    el.board.appendChild(meldRow(entry, fresh, news, canTake));
  }

  const zones = document.createElement('div');
  zones.className = 'zones';
  zones.append(
    zoneEl('Группы', groups, fresh, news, canTake),
    zoneEl('Ряды', runs, fresh, news, canTake)
  );
  el.board.appendChild(zones);
}

/**
 * Умное подсвечивание: с чем «женится» выбранное. На лотке гаснут фишки,
 * которые ни в какой набор с выбранными не лягут (5 красная и 1 чёрная
 * не поженятся никогда); на столе зелёным помечаются фишки, которые можно
 * забрать, не сломав набор (край ряда 4+, любая из четвёрки), и которые
 * подходят к выбранным.
 */
function computeMarks(busy, player) {
  dimIds = new Set();
  mateIds = new Set();
  if (busy || !selection.size) return;

  const selTiles = G.tilesOf(state, [...selection]);
  const rackTiles = G.tilesOf(state, player.rack).filter((t) => !selection.has(t.id));
  const rackJokers = rackTiles.filter((t) => t.joker).length;
  const rackHas = new Set(rackTiles.filter((t) => !t.joker).map((t) => t.color + t.num));

  // Может ли `tile` вместе с выбранными дорасти до правильного набора:
  // группа — одно число без повторов цвета; ряд — один цвет без повторов,
  // а дыры закрываются фишками с лотка или джокерами.
  const marries = (tile) => {
    const all = [...selTiles, tile];
    const naturals = all.filter((t) => !t.joker);
    if (!naturals.length) return true;
    const jokersIn = all.length - naturals.length;

    if (all.length <= 4 && naturals.every((t) => t.num === naturals[0].num)) {
      const colors = naturals.map((t) => t.color);
      if (new Set(colors).size === colors.length) return true;
    }

    const color = naturals[0].color;
    if (naturals.every((t) => t.color === color)) {
      const nums = naturals.map((t) => t.num);
      if (new Set(nums).size === nums.length) {
        let spare = jokersIn + rackJokers;
        for (let n = Math.min(...nums) + 1; n < Math.max(...nums); n++) {
          if (nums.includes(n) || rackHas.has(color + n)) continue;
          if (spare-- <= 0) return false;
        }
        return true;
      }
    }
    return false;
  };

  for (const tile of rackTiles) if (!marries(tile)) dimIds.add(tile.id);

  if (player.melded) {
    for (const meld of state.board) {
      if (meld.some((id) => selection.has(id))) continue;
      const info = G.meldInfo(state, meld);
      if (!info.valid || meld.length < 4) continue;
      const cand =
        info.type === 'run'
          ? [info.ordered[0], info.ordered[info.ordered.length - 1]]
          : info.ordered;
      for (const t of cand) if (marries(t)) mateIds.add(t.id);
    }
  }
}

function zoneEl(title, list, fresh, news, canTake) {
  const zone = document.createElement('div');
  zone.className = 'zone';
  const head = document.createElement('div');
  head.className = 'zone-head';
  head.textContent = title;
  zone.appendChild(head);
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'zone-empty';
    empty.textContent = 'пока пусто';
    zone.appendChild(empty);
  }
  for (const entry of list) zone.appendChild(meldRow(entry, fresh, news, canTake));
  return zone;
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

/**
 * «Умная» раскладка лотка: жадно выбираем непересекающиеся готовые наборы
 * (сначала самые дорогие — их шанс выставить выше), раскладываем их слева
 * направо от меньших чисел к большим и отделяем пробелами; остаток — по
 * возрастанию номинала. Что можно выставить обособленно, видно сразу.
 */
function smartArrange(ids) {
  const key = ids.slice().sort().join('|');
  if (smartCache && smartCache.key === key) return smartCache.res;

  const tiles = G.tilesOf(state, ids);
  const used = new Set();
  const clusters = [];
  for (const s of findSets(tiles)) {
    if (s.tiles.some((t) => used.has(t.id))) continue;
    s.tiles.forEach((t) => used.add(t.id));
    const info = G.meldInfo(state, s.tiles.map((t) => t.id));
    clusters.push({ ids: info.ordered.map((t) => t.id), min: Math.min(...info.values) });
  }
  clusters.sort((a, b) => a.min - b.min);

  const rest = tiles
    .filter((t) => !used.has(t.id))
    .sort(
      (a, b) =>
        (a.joker ? 99 : a.num) - (b.joker ? 99 : b.num) ||
        COLORS.indexOf(a.color) - COLORS.indexOf(b.color)
    )
    .map((t) => t.id);

  const segments = clusters.map((c) => c.ids);
  if (rest.length) segments.push(rest);
  const order = [];
  const breaks = new Set();
  segments.forEach((seg, i) => {
    order.push(...seg);
    if (i < segments.length - 1) breaks.add(order.length - 1);
  });

  const res = { order, breaks };
  smartCache = { key, res };
  return res;
}

function renderRack() {
  const player = G.currentPlayer(state);
  el.rack.innerHTML = '';

  if (state.phase !== 'play') return;

  if (!player.rack.length) {
    const note = document.createElement('p');
    note.className = 'rack-empty';
    // Если бы стол был правильным, победа уже показалась бы сама.
    note.textContent = 'Все фишки выложены! Осталось собрать стол правильно.';
    el.rack.appendChild(note);
    return;
  }

  // В «умном» режиме готовые наборы отделяются пробелами.
  let ids = player.rack;
  let breaks = new Set();
  if (sortMode === 'smart') {
    const arranged = smartArrange(player.rack);
    ids = arranged.order;
    breaks = arranged.breaks;
  }

  // Взятые из мешка фишки подсвечиваются как «новые для вас» (голубым).
  const drawn = new Set(player.drawn || []);
  G.tilesOf(state, ids).forEach((tile, i) => {
    el.rack.appendChild(tileNode(tile, null, null, drawn));
    if (breaks.has(i)) {
      const gap = document.createElement('i');
      gap.className = 'rack-gap';
      el.rack.appendChild(gap);
    }
  });
  fitRack(ids.length, breaks.size);
}

/**
 * Все фишки руки должны быть видны разом, без прокрутки: при большой руке
 * уменьшаем фишки лотка так, чтобы они влезли в отведённые ряды
 * (2 в ландшафте, 3 в портрете). Ниже 26px не ужимаем — палец должен
 * попадать; в этом крайнем случае лоток прокручивается.
 */
function fitRack(count, spacers = 0) {
  el.rack.style.removeProperty('--tile-w');
  if (!count) return;
  const tile = el.rack.querySelector('.tile');
  if (!tile) return;

  const rows = document.body.classList.contains('land') ? 2 : 3;
  const perRow = Math.ceil(count / rows);
  const styles = getComputedStyle(el.rack);
  const gap = parseFloat(styles.columnGap) || 4;
  const width =
    el.rack.clientWidth -
    (parseFloat(styles.paddingLeft) || 0) -
    (parseFloat(styles.paddingRight) || 0) -
    // Пробелы умной раскладки тоже занимают место в рядах.
    Math.ceil(spacers / rows) * 12;

  const fitted = (width - (perRow - 1) * gap) / perRow;
  if (fitted < tile.offsetWidth) {
    el.rack.style.setProperty('--tile-w', `${Math.max(26, Math.floor(fitted))}px`);
  }
}

/**
 * Панель выделения в боковой панели: мини-копии выбранных фишек и, если
 * выбранное с руки во что-то складывается, строка комбинаций.
 *
 * У панели своё постоянное место между «Лотком» и «Ходом»: она занимает
 * свободную середину и никогда не появляется поверх стола. Пустая панель
 * остаётся на месте с подсказкой — от выбора фишки ничего не сдвигается.
 */
function renderSelPanel() {
  el.selPanel.innerHTML = '';
  const idle = !state || state.phase !== 'play' || !selection.size;
  el.selPanel.classList.toggle('is-idle', idle);
  if (idle) {
    const hint = document.createElement('p');
    hint.className = 'sel-hint';
    hint.textContent = 'Нажмите на фишки — выбранное появится здесь.';
    el.selPanel.appendChild(hint);
    return;
  }

  el.selPanel.appendChild(selRow());
  const combos = comboOptions();
  if (combos.length) el.selPanel.appendChild(comboRow(combos));
}

/** Строка «Выбрано: …»: тап по мини-фишке снимает её, ✕ — всё выделение. */
function selRow() {
  const row = document.createElement('div');
  row.className = 'sel-row';
  const cap = document.createElement('span');
  cap.className = 'sel-cap';
  cap.textContent = 'Выбрано:';
  row.appendChild(cap);
  for (const tile of G.tilesOf(state, [...selection])) {
    const chip = document.createElement('button');
    chip.className = `sel-chip c-${tile.color}`;
    chip.dataset.id = tile.id;
    chip.textContent = tile.joker ? '★' : String(tile.num);
    row.appendChild(chip);
  }
  const clear = document.createElement('button');
  clear.className = 'sel-clear';
  clear.setAttribute('aria-label', 'Снять всё выделение');
  clear.textContent = '✕';
  row.appendChild(clear);
  return row;
}

/**
 * Умная группировка: наборы с руки, в которые складывается выбранное.
 * Одна и та же фишка часто годится в несколько комбинаций — тап по чипу
 * выбирает нужную целиком.
 */
function comboOptions() {
  const player = G.currentPlayer(state);
  const rackSet = new Set(player.rack);
  const selected = [...selection];
  if (!selected.every((id) => rackSet.has(id))) return [];

  const all = findSets(G.tilesOf(state, player.rack)).filter((s) =>
    selected.every((id) => s.tiles.some((t) => t.id === id))
  );
  // Дубликаты по составу (вторая копия той же фишки) не показываем.
  const seen = new Set();
  const options = [];
  for (const s of all) {
    const key = s.tiles.map((t) => (t.joker ? '★' : t.color + t.num)).sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(s);
    if (options.length >= 10) break;
  }

  // Джокер лучше приберечь — комбинации с ним показываем последними.
  options.sort(
    (a, b) =>
      Number(a.tiles.some((t) => t.joker)) - Number(b.tiles.some((t) => t.joker))
  );
  return options.slice(0, 6);
}

function comboRow(options) {
  const player = G.currentPlayer(state);
  const row = document.createElement('div');
  row.className = 'combo-row';
  const label = document.createElement('span');
  label.className = 'combo-label';
  label.textContent = 'Комбинации:';
  row.appendChild(label);
  for (const s of options) {
    const chip = document.createElement('button');
    chip.className = 'combo-chip';
    chip.dataset.ids = s.tiles.map((t) => t.id).join(',');
    chip.textContent = s.tiles.map((t) => (t.joker ? '★' : t.num)).join('·');
    // Сумма очков важна только до выхода, когда идёт счёт до 30.
    if (!player.melded) {
      const pts = document.createElement('b');
      pts.textContent = ` ${s.points}`;
      chip.appendChild(pts);
    }
    row.appendChild(chip);
  }
  return row;
}

/* ---------- таймер хода ---------- */

function armTurnTimer() {
  if (!state) return;
  state.deadline =
    state.timerSec && state.phase === 'play' ? Date.now() + state.timerSec * 1000 : null;
  updateTimerChip();
}

function updateTimerChip() {
  const show = !!(state && state.phase === 'play' && state.timerSec && state.deadline);
  el.hudTimer.hidden = !show;
  if (!show) return;
  const left = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
  el.hudTimer.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  el.hudTimer.classList.toggle('is-low', left <= 15);
}

function tickTimer() {
  if (!state || state.phase !== 'play' || !state.timerSec || !state.deadline) return;
  updateTimerChip();
  if (Date.now() < state.deadline) return;
  state.deadline = null;
  closeConfirm(false); // время вышло — открытый вопрос уже не актуален
  // Если разложенное на столе уже образует правильный ход — обидно терять
  // его из-за секунд: засчитываем как есть. Фишка берётся только когда
  // ход в текущем виде завершить нельзя.
  if (G.validateTurn(state).ok) {
    toast('Время вышло — разложенный ход засчитан.');
    endTurn();
    return;
  }
  toast('Время хода вышло — фишка взята автоматически.', true);
  forceDraw();
}

setInterval(tickTimer, 500);

/** Копилка очков за несколько партий одного состава (для игры «до N побед»). */
function updateSeries() {
  if (state.seriesApplied) return readSeries();
  const key = state.players.map((p) => p.name).join('|');
  let series = readSeries();
  if (!series || series.key !== key) {
    series = { key, totals: state.players.map(() => 0), games: 0 };
  }
  state.players.forEach((p, i) => { series.totals[i] += p.score; });
  series.games += 1;
  try { localStorage.setItem(SERIES_KEY, JSON.stringify(series)); } catch { /* ну и ладно */ }
  state.seriesApplied = true;
  save();
  return series;
}

function readSeries() {
  try {
    return JSON.parse(localStorage.getItem(SERIES_KEY)) || null;
  } catch {
    return null;
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

  const series = updateSeries();
  const showSeries = series && series.games > 1;
  el.seriesLine.hidden = !showSeries;
  el.btnSeriesReset.hidden = !showSeries;
  if (showSeries) {
    const parts = state.players.map(
      (p, i) => `${p.name} ${series.totals[i] > 0 ? '+' : ''}${series.totals[i]}`
    );
    el.seriesLine.textContent = `Серия из ${series.games} партий: ${parts.join(' · ')}`;
  }

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
  G.moveTiles(state, [...selection], meldIndex);
  selection.clear();
  hintIds.clear();
  buzz(8);
  save();
  if (maybeAutoWin()) return;
  render();
}

/**
 * Игрок выложил последнюю фишку и стол правильный — победа показывается
 * сразу, без лишнего нажатия «Ход сделан».
 */
function maybeAutoWin() {
  if (!state || state.phase !== 'play') return false;
  if (G.currentPlayer(state).rack.length) return false;
  if (!G.validateTurn(state).ok) return false;
  endTurn();
  return true;
}

/**
 * Кнопка «Выставить»: сама решает, куда положить выбранное.
 * Валидный набор — новым набором; иначе ищет на столе набор, который
 * примет фишки целиком; в крайнем случае кладёт отдельно (как «＋ Новый
 * набор») — достроить можно следующими ходами руки.
 */
function smartPlace() {
  if (state.phase !== 'play') return;
  if (!selection.size) {
    toast('Сначала выберите фишки — нажмите на них.');
    return;
  }
  const player = G.currentPlayer(state);
  const ids = [...selection];

  if (G.meldInfo(state, ids).valid) {
    placeSelection(-1);
    return;
  }

  if (player.melded) {
    for (let i = 0; i < state.board.length; i++) {
      if (state.board[i].some((id) => selection.has(id))) continue;
      if (G.meldInfo(state, [...state.board[i], ...ids]).valid) {
        placeSelection(i);
        return;
      }
    }
  }

  placeSelection(-1);
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
  const outlook = firstMeldOutlook();
  const hint = findHint(state, G.tilesOf, G.currentPlayer(state), outlook);
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
  runAutoSkip();
  save();
  buzz(14);
  render();
}

async function drawTile() {
  const hadChanges = state.history.length > 0;
  // Случайное нажатие теряет весь разложенный ход — переспрашиваем.
  if (hadChanges) {
    const token = `${state.round}:${state.turn}`;
    const ok = await askConfirm(
      'Взять фишку? Всё, что вы разложили в этом ходу, вернётся как было, и ход перейдёт дальше.',
      'Взять фишку'
    );
    // Пока думали, ход мог закончиться (например, по таймеру).
    if (!ok || state.phase !== 'play' || `${state.round}:${state.turn}` !== token) return;
  }
  forceDraw();
  if (hadChanges) toast('Перестановки отменены, ход передан дальше.');
}

/** Взять фишку без вопросов: общий финал добора и срабатывания таймера. */
function forceDraw() {
  G.drawAndPass(state);
  selection.clear();
  hintIds.clear();
  runAutoSkip();
  save();
  render();
}

/* ---------- события ---------- */

el.countPicker.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-count]');
  if (!btn) return;
  playerCount = Number(btn.dataset.count);
  [...el.countPicker.children].forEach((c) => c.classList.toggle('is-active', c === btn));
  renderNameInputs();
  renderRoster();
});

// Тап по чипу — имя встаёт в первое свободное поле; ✕ — забыть игрока.
el.rosterChips.addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    writeRoster(readRoster().filter((n) => n !== del.dataset.del));
    renderRoster();
    return;
  }
  const chip = e.target.closest('.roster-chip');
  if (!chip) return;
  const inputs = [...el.nameInputs.querySelectorAll('input')];
  const empty = inputs.find((i) => !i.value.trim());
  if (!empty) {
    toast('Все места заняты — очистите одно из полей.');
    return;
  }
  empty.value = chip.dataset.name;
  renderRoster();
});

// Имя, набранное вручную, прячет совпадающий чип.
el.nameInputs.addEventListener('input', renderRoster);

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

/**
 * Быстрая игра — неточные нажатия: промах на пару пикселей мимо фишки
 * не должен превращаться в другое действие. Ищем ближайшую фишку рядом
 * с точкой нажатия и считаем, что нажали на неё.
 */
function nearestTile(container, x, y, maxDist = 12) {
  let best = null;
  let bestDist = maxDist;
  for (const t of container.querySelectorAll('.tile')) {
    const r = t.getBoundingClientRect();
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const d = Math.hypot(dx, dy);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

el.board.addEventListener('click', (e) => {
  if (state?.phase !== 'play') return;
  const player = G.currentPlayer(state);
  const locked = lockedOnBoard();

  const meld = e.target.closest('.meld');

  // Ячейка «＋» в конце набора — положить выбранное в него.
  if (e.target.closest('.slot-add') && meld) {
    const index = Number(meld.dataset.index);
    if (!player.melded && state.board[index].some((id) => locked.has(id))) {
      toast('До первого выхода можно выкладывать только свои новые наборы.', true);
      return;
    }
    if (selection.size) placeSelection(index);
    else selectMeld(index);
    return;
  }

  let tile = e.target.closest('.tile');
  if (!tile && meld) tile = nearestTile(meld, e.clientX, e.clientY);
  if (tile) {
    // До первого выхода стол неприкосновенен — не даём даже выделять,
    // чтобы не собрать ход, который всё равно не примется.
    if (!player.melded && locked.has(tile.dataset.id)) {
      toast('До первого выхода наборы на столе трогать нельзя.', true);
      return;
    }
    toggleTile(tile.dataset.id);
    return;
  }

  if (meld) {
    const index = Number(meld.dataset.index);
    const isLockedMeld = state.board[index].some((id) => locked.has(id));
    if (!player.melded && isLockedMeld) {
      toast('До первого выхода можно выкладывать только свои новые наборы.', true);
      return;
    }
    if (selection.size) placeSelection(index);
    else selectMeld(index);
    return;
  }

  // Пустое место на столе — сброс выделения.
  if (selection.size) {
    selection.clear();
    render();
  }
});

el.rack.addEventListener('click', (e) => {
  // Промах между фишками полного лотка — выбираем ближайшую, а не «пусто».
  const tile = e.target.closest('.tile') || nearestTile(el.rack, e.clientX, e.clientY, 14);
  if (tile) toggleTile(tile.dataset.id);
});

el.btnSort.addEventListener('click', () => {
  const modes = ['run', 'group', 'smart'];
  sortMode = modes[(modes.indexOf(sortMode) + 1) % modes.length];
  // Видимый отклик нажатия: кнопка коротко «моргает».
  el.btnSort.classList.remove('is-flash');
  void el.btnSort.offsetWidth;
  el.btnSort.classList.add('is-flash');

  const orderOf = (ids) =>
    sortMode === 'smart' ? smartArrange(ids).order : sortRack(ids);
  const player = G.currentPlayer(state);
  player.rack = orderOf(player.rack);
  // Порядок руки — косметика. Переносим его и в снимки хода, иначе
  // «Отменить» или добор вернут старый порядок и фишки скакнут.
  const rewrite = (snap) => {
    const data = JSON.parse(snap);
    data.racks[state.turn] = orderOf(data.racks[state.turn]);
    return JSON.stringify(data);
  };
  state.startSnapshot = rewrite(state.startSnapshot);
  state.history = state.history.map(rewrite);
  save();
  render();
});

el.btnUndo.addEventListener('click', () => {
  if (G.undo(state)) {
    selection.clear();
    save();
    render();
  }
});

el.btnToRack.addEventListener('click', toRack);
el.btnPlace.addEventListener('click', smartPlace);
el.btnDraw.addEventListener('click', drawTile);
el.btnEnd.addEventListener('click', endTurn);

// Панель выделения над лотком: тап по комбинации выбирает её фишки целиком,
// тап по мини-фишке снимает её, ✕ — снимает всё выделение.
el.selPanel.addEventListener('click', (e) => {
  const combo = e.target.closest('.combo-chip');
  if (combo) {
    selection = new Set(combo.dataset.ids.split(','));
    hintIds.clear();
    render();
    return;
  }
  const chip = e.target.closest('.sel-chip');
  if (chip) {
    selection.delete(chip.dataset.id);
    render();
    return;
  }
  if (e.target.closest('.sel-clear')) {
    selection.clear();
    render();
  }
});

// Кружок цвета на экране настройки — перебор свободных цветов.
el.nameInputs.addEventListener('click', (e) => {
  const dot = e.target.closest('.color-dot');
  if (dot) cyclePlayerColor(Number(dot.dataset.player));
});

el.timerPicker.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-timer]');
  if (!btn) return;
  timerSec = Number(btn.dataset.timer);
  localStorage.setItem(TIMER_KEY, String(timerSec));
  [...el.timerPicker.children].forEach((c) => c.classList.toggle('is-active', c === btn));
});

el.btnConfirmYes.addEventListener('click', () => closeConfirm(true));
el.btnConfirmNo.addEventListener('click', () => closeConfirm(false));

el.btnReady.addEventListener('click', () => {
  // Игрок увидел сводку на экране передачи — счётчик автовзятий обнуляем.
  G.currentPlayer(state).autoDrawn = 0;
  G.beginTurn(state);
  armTurnTimer();
  save();
  render();
});

el.btnNewGame.addEventListener('click', () => {
  localStorage.removeItem(SAVE_KEY);
  showSetup();
});

el.btnSeriesReset.addEventListener('click', async () => {
  if (!(await askConfirm('Обнулить накопленный счёт серии?', 'Обнулить'))) return;
  localStorage.removeItem(SERIES_KEY);
  el.seriesLine.hidden = true;
  el.btnSeriesReset.hidden = true;
});

$('btnMenu').addEventListener('click', () => { el.overlayMenu.hidden = false; });
$('btnCloseMenu').addEventListener('click', () => { el.overlayMenu.hidden = true; });

$('btnHintMenu').addEventListener('click', () => {
  el.overlayMenu.hidden = true;
  doHint();
});

$('btnResetTurn').addEventListener('click', () => {
  G.resetTurn(state);
  selection.clear();
  hintIds.clear();
  el.overlayMenu.hidden = true;
  save();
  render();
  toast('Ход отменён — стол как в начале хода.');
});

$('btnQuit').addEventListener('click', async () => {
  el.overlayMenu.hidden = true;
  if (await askConfirm('Выйти в начало? Партия останется сохранённой.', 'Выйти')) showSetup();
});

const openRules = () => { el.overlayRules.hidden = false; };
$('btnRulesSetup').addEventListener('click', openRules);
$('btnRulesGame').addEventListener('click', () => {
  el.overlayMenu.hidden = true;
  openRules();
});
$('btnCloseRules').addEventListener('click', () => { el.overlayRules.hidden = true; });

/* ---------- полноэкранный режим ---------- */

if (!document.documentElement.requestFullscreen) {
  el.btnFull.hidden = true; // iOS Safari: ставьте на главный экран — там и так весь экран
}
el.btnFull.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      try { await screen.orientation.lock('landscape'); } catch { /* не везде можно */ }
    }
  } catch { /* пользователь отказался — не страшно */ }
});

/* ---------- запуск ---------- */

// Незаконченная партия продолжается сама — можно закрывать игру когда угодно.
const savedGame = loadSave();
if (savedGame) {
  state = savedGame;
  enterGame();
} else {
  showSetup();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .then((reg) => reg.update())
      .catch(() => {});
  });

  // Новая версия установилась и перехватила страницу — перезапускаемся,
  // чтобы не играть в старую из кэша. Партия сохранена, ничего не теряется.
  let hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true; // самая первая установка — перезапуск не нужен
      return;
    }
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}
