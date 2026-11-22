/**
 * Компактный звуковой отклик на Web Audio API без внешних файлов.
 * Тихо деградирует, если AudioContext или localStorage недоступны.
 */

const SOUND_KEY = 'rummikub:sound';

let ctx = null;
let enabled = null;

export function isSoundEnabled() {
  if (enabled !== null) return enabled;
  try {
    enabled = localStorage.getItem(SOUND_KEY) !== '0';
  } catch {
    enabled = true;
  }
  return enabled;
}

export function setSoundEnabled(next) {
  enabled = Boolean(next);
  try {
    localStorage.setItem(SOUND_KEY, enabled ? '1' : '0');
  } catch { /* приватный режим */ }
}

export function toggleSound() {
  const next = !isSoundEnabled();
  setSoundEnabled(next);
  return next;
}

function getContext() {
  if (!isSoundEnabled()) return null;
  const AudioCtx =
    typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AudioCtx) return null;
  try {
    if (!ctx) ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

function tone(audio, { type = 'sine', f0, f1 = f0, start = 0, duration = 0.04, gain = 0.08 }) {
  const t0 = audio.currentTime + start;
  const t1 = t0 + duration;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t1);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.linearRampToValueAtTime(gain, t0 + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(amp);
  amp.connect(audio.destination);
  osc.start(t0);
  osc.stop(t1 + 0.005);
}

/** Мягкий короткий деревянный/керамический клик при выборе фишки. */
export function playSelect() {
  const audio = getContext();
  if (!audio) return;
  try {
    tone(audio, { type: 'triangle', f0: 820, f1: 440, duration: 0.028, gain: 0.075 });
  } catch { /* тихо игнорируем */ }
}

/** Чуть более весомый стук при выкладывании или переносе фишек. */
export function playPlace() {
  const audio = getContext();
  if (!audio) return;
  try {
    tone(audio, { type: 'triangle', f0: 360, f1: 170, duration: 0.044, gain: 0.12 });
    tone(audio, { type: 'sine', f0: 1180, f1: 680, duration: 0.02, gain: 0.05 });
  } catch { /* тихо игнорируем */ }
}

/** Тёплый двойной (или тройной при победе) тон при завершении хода. */
export function playTurnEnd(win = false) {
  const audio = getContext();
  if (!audio) return;
  try {
    tone(audio, { type: 'sine', f0: 523.25, duration: 0.14, gain: 0.085 });
    tone(audio, { type: 'sine', f0: 659.25, start: 0.075, duration: 0.17, gain: 0.09 });
    if (win) {
      tone(audio, { type: 'sine', f0: 783.99, start: 0.155, duration: 0.24, gain: 0.1 });
    }
  } catch { /* тихо игнорируем */ }
}

/** Мягкий низкий сигнал при ошибке. */
export function playError() {
  const audio = getContext();
  if (!audio) return;
  try {
    tone(audio, { type: 'triangle', f0: 210, f1: 145, duration: 0.12, gain: 0.09 });
  } catch { /* тихо игнорируем */ }
}
