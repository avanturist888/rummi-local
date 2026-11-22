/**
 * Стабильная раскладка стола во время хода.
 *
 * Между ходами (в начале хода, после отмены всего хода или завершения хода)
 * наборы аккуратно раскладываются по колонкам «Группы» и «Ряды» с сортировкой.
 * Пока идёт ход, существующие наборы держат свои колонки и места — даже если
 * набор временно сломан (невалиден), он не улетает в отдельную зону и не
 * сдвигает соседей. Новые наборы встают в конец своей колонки, а вторая часть
 * распавшегося ряда (splitRun) — сразу за первой.
 *
 * Модуль чистый — без DOM и без изменения формата сохранения state.
 */

import { COLORS, analyze } from './rules.js';

/**
 * Определяет колонку ('group' | 'run') и ключ сортировки для набора.
 * Для наборов с неясным типом выбирается колонка 'run' (она шире).
 */
export function classifyMeld(tileObjs, info = analyze(tileObjs)) {
  if (info.valid) {
    if (info.type === 'group') {
      return { zone: 'group', key: [info.values[0], 0] };
    }
    const firstNatural = info.ordered.find((t) => !t.joker);
    return {
      zone: 'run',
      key: [COLORS.indexOf(firstNatural.color), info.values[0]],
    };
  }

  const naturals = tileObjs.filter((t) => !t.joker);
  if (naturals.length >= 2) {
    const sameNum = naturals.every((t) => t.num === naturals[0].num);
    const distinctColors = new Set(naturals.map((t) => t.color)).size === naturals.length;
    const sameColor = naturals.every((t) => t.color === naturals[0].color);
    const distinctNums = new Set(naturals.map((t) => t.num)).size === naturals.length;

    if (sameNum && distinctColors) {
      return { zone: 'group', key: [naturals[0].num, 0] };
    }
    if (sameColor && distinctNums) {
      return {
        zone: 'run',
        key: [COLORS.indexOf(naturals[0].color), Math.min(...naturals.map((t) => t.num))],
      };
    }
    if (sameNum) {
      return { zone: 'group', key: [naturals[0].num, 0] };
    }
    if (sameColor) {
      return {
        zone: 'run',
        key: [COLORS.indexOf(naturals[0].color), Math.min(...naturals.map((t) => t.num))],
      };
    }
  }

  return { zone: 'run', key: [99, 0] };
}

function buildEntries(board, tilesMap) {
  return board.map((meld, index) => {
    const tileObjs = meld.map((id) => tilesMap[id]);
    const info = analyze(tileObjs);
    return { meld, index, info, tileObjs };
  });
}

const toResult = (entry) => ({
  meld: entry.meld,
  index: entry.index,
  info: entry.info,
});

export function createBoardLayout() {
  let zones = { group: [], run: [] };
  let history = [];
  let initialized = false;

  /**
   * Полная аккуратная раскладка («причёсывание» стола).
   * Вызывается при входе в ход, старте/загрузке партии, сбросе и конце хода.
   */
  function reset(board, tilesMap) {
    history = [];
    const entries = buildEntries(board, tilesMap).map((entry) => ({
      ...entry,
      ...classifyMeld(entry.tileObjs, entry.info),
    }));

    const byKey = (a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.index - b.index;
    const groups = entries.filter((e) => e.zone === 'group').sort(byKey);
    const runs = entries.filter((e) => e.zone === 'run').sort(byKey);

    zones = {
      group: groups.map((e) => ({ tiles: e.meld.slice() })),
      run: runs.map((e) => ({ tiles: e.meld.slice() })),
    };
    initialized = true;

    return {
      groups: groups.map(toResult),
      runs: runs.map(toResult),
    };
  }

  const cloneZones = (z) => ({
    group: z.group.map((s) => ({ tiles: s.tiles.slice() })),
    run: z.run.map((s) => ({ tiles: s.tiles.slice() })),
  });

  /** Сохраняет снимок текущей раскладки перед мутацией хода (для точного undo). */
  function push() {
    if (!initialized) return;
    history.push(cloneZones(zones));
    if (history.length > 200) history.shift();
  }

  /** Восстанавливает снимок раскладки при undo. */
  function pop() {
    const prev = history.pop();
    if (!prev) return false;
    zones = prev;
    return true;
  }

  /** Сериализует текущее состояние и историю раскладки (для восстановления после перезагрузки). */
  function serialize() {
    return {
      initialized,
      zones: cloneZones(zones),
      history: history.map(cloneZones),
    };
  }

  /** Восстанавливает состояние и историю раскладки из serialize(). */
  function restore(saved) {
    if (
      !saved ||
      !saved.initialized ||
      !saved.zones ||
      !Array.isArray(saved.zones.group) ||
      !Array.isArray(saved.zones.run) ||
      !Array.isArray(saved.history)
    ) {
      return false;
    }
    zones = cloneZones(saved.zones);
    history = saved.history.map(cloneZones);
    initialized = true;
    return true;
  }

  /**
   * Восстанавливает раскладку и её историю по снимкам хода из state
   * (fallback при загрузке сохранённой партии посреди хода).
   */
  function rebuildFromState(state) {
    if (!state || !Array.isArray(state.history) || state.history.length === 0) {
      return reset(state ? state.board : [], state ? state.tiles : {});
    }
    const snaps = state.history.map((raw) => JSON.parse(raw).board);
    reset(snaps[0], state.tiles);
    for (let i = 1; i < snaps.length; i++) {
      push();
      sync(snaps[i], state.tiles);
    }
    push();
    return sync(state.board, state.tiles);
  }

  /**
   * Синхронизирует раскладку с текущим столом во время хода:
   * - при явном переносе в существующий набор (targetPrevTiles) результат
   *   держится на месте цели, даже если из источника пришло больше фишек;
   * - существующие наборы сохраняют колонку и порядок по оставшимся фишкам;
   * - куски распавшегося ряда встают сразу за исходным рядом;
   * - новые наборы встают в конец своей колонки.
   */
  function sync(board, tilesMap, options = {}) {
    if (!initialized) return reset(board, tilesMap);

    const entries = buildEntries(board, tilesMap);
    const prevSlots = [
      ...zones.group.map((slot) => ({ zone: 'group', tileSet: new Set(slot.tiles) })),
      ...zones.run.map((slot) => ({ zone: 'run', tileSet: new Set(slot.tiles) })),
    ];

    const slotPrimary = new Map();
    const assignedEntries = new Set();

    // 0. Если известен целевой набор переноса, закрепляем объединённый набор за его слотом.
    const { targetPrevTiles } = options;
    if (Array.isArray(targetPrevTiles) && targetPrevTiles.length > 0) {
      const targetSlotIdx = prevSlots.findIndex(
        (slot) =>
          slot.tileSet.size === targetPrevTiles.length &&
          targetPrevTiles.every((id) => slot.tileSet.has(id))
      );
      if (targetSlotIdx >= 0) {
        const targetEntryIdx = entries.findIndex(
          (entry) =>
            entry.meld.length >= targetPrevTiles.length &&
            targetPrevTiles.every((id) => entry.meld.includes(id))
        );
        if (targetEntryIdx >= 0) {
          slotPrimary.set(targetSlotIdx, entries[targetEntryIdx]);
          assignedEntries.add(targetEntryIdx);
        }
      }
    }

    // 1. Первичное сопоставление наборов с прошлыми слотами по максимальному числу общих фишек.
    const pairs = [];
    for (let eIdx = 0; eIdx < entries.length; eIdx++) {
      if (assignedEntries.has(eIdx)) continue;
      const meld = entries[eIdx].meld;
      if (!meld.length) continue;
      for (let sIdx = 0; sIdx < prevSlots.length; sIdx++) {
        if (slotPrimary.has(sIdx)) continue;
        let overlap = 0;
        const set = prevSlots[sIdx].tileSet;
        for (const id of meld) {
          if (set.has(id)) overlap++;
        }
        if (overlap > 0) {
          // В G.moveTiles уцелевшие фишки целевого набора остаются в начале meld,
          // а перенесённые дописываются в конец — поэтому слот с meld[0] это цель слияния.
          pairs.push({
            eIdx,
            sIdx,
            overlap,
            ratio: overlap / meld.length,
            hasFirst: set.has(meld[0]) ? 1 : 0,
          });
        }
      }
    }

    pairs.sort((a, b) => {
      const pureA = a.ratio === 1 ? 1 : 0;
      const pureB = b.ratio === 1 ? 1 : 0;
      if (pureA !== pureB) return pureB - pureA;
      if (pureA) return a.eIdx - b.eIdx || a.sIdx - b.sIdx;
      return (
        b.hasFirst - a.hasFirst ||
        b.ratio - a.ratio ||
        b.overlap - a.overlap ||
        a.eIdx - b.eIdx ||
        a.sIdx - b.sIdx
      );
    });

    for (const pair of pairs) {
      if (assignedEntries.has(pair.eIdx) || slotPrimary.has(pair.sIdx)) continue;
      slotPrimary.set(pair.sIdx, entries[pair.eIdx]);
      assignedEntries.add(pair.eIdx);
    }

    // 2. Вторые (и последующие) куски распавшегося длинного ряда встают сразу за первым.
    const slotSiblings = new Map();
    for (let eIdx = 0; eIdx < entries.length; eIdx++) {
      if (assignedEntries.has(eIdx)) continue;
      const entry = entries[eIdx];
      if (!entry.info.valid || entry.info.type !== 'run') continue;

      const parentSlotIdx = prevSlots.findIndex(
        (slot) =>
          slot.zone === 'run' &&
          entry.meld.length > 0 &&
          entry.meld.every((id) => slot.tileSet.has(id))
      );
      if (parentSlotIdx >= 0) {
        if (!slotSiblings.has(parentSlotIdx)) slotSiblings.set(parentSlotIdx, []);
        slotSiblings.get(parentSlotIdx).push(entry);
        assignedEntries.add(eIdx);
      }
    }

    // 3. Собираем колонки в прежнем порядке, а новые наборы добавляем в конец.
    const out = { group: [], run: [] };
    for (let sIdx = 0; sIdx < prevSlots.length; sIdx++) {
      const zone = prevSlots[sIdx].zone;
      if (slotPrimary.has(sIdx)) out[zone].push(slotPrimary.get(sIdx));
      if (slotSiblings.has(sIdx)) out[zone].push(...slotSiblings.get(sIdx));
    }

    for (let eIdx = 0; eIdx < entries.length; eIdx++) {
      if (assignedEntries.has(eIdx)) continue;
      const entry = entries[eIdx];
      const { zone } = classifyMeld(entry.tileObjs, entry.info);
      out[zone].push(entry);
    }

    zones = {
      group: out.group.map((e) => ({ tiles: e.meld.slice() })),
      run: out.run.map((e) => ({ tiles: e.meld.slice() })),
    };

    return {
      groups: out.group.map(toResult),
      runs: out.run.map(toResult),
    };
  }

  return { reset, sync, push, pop, serialize, restore, rebuildFromState };
}
