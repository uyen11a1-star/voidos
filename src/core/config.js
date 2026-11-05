import { clampRamSize, safeRamLimit } from '../hardware/ram.js';

export const THEMES = ['gold', 'azure', 'crimson', 'emerald', 'violet'];
export const DEFAULT_CONFIG = Object.freeze({
  hostname: 'voidos', ramKB: 1024, quotaKB: 8192, resolution: 'auto', theme: 'gold', fastBoot: false, clock24: true, volume: 50,
  wallpaper: 'gen:voidgold', musicVolume: 40, musicAutoplay: false, lockscreen: true,
});
export const HARDWARE_KEYS = ['ramKB']; // changes that only apply after a reboot

const RULES = {
  hostname: (v) => typeof v === 'string' && /^[a-z0-9-]{1,32}$/i.test(v),
  ramKB: (v) => Number.isInteger(v) && v >= 256 && v <= safeRamLimit() / 1024 && clampRamSize(v * 1024) === v * 1024,
  quotaKB: (v) => Number.isInteger(v) && v >= 1024 && v <= 262144,
  resolution: (v) => { if (v === 'auto') return true; const m = /^(\d{2,4})x(\d{2,4})$/.exec(v); return !!m && +m[1] >= 32 && +m[2] >= 32 && m[1] * m[2] <= 1 << 20; },
  theme: (v) => THEMES.includes(v),
  fastBoot: (v) => typeof v === 'boolean',
  clock24: (v) => typeof v === 'boolean',
  volume: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
  wallpaper: (v) => typeof v === 'string' && (/^gen:[a-z0-9-]{1,24}$/.test(v) || /^file:\/[^\0]{1,200}$/.test(v)),
  musicVolume: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
  musicAutoplay: (v) => typeof v === 'boolean',
  lockscreen: (v) => typeof v === 'boolean',
};

// Invalid or unknown values fall back to defaults (a damaged config must never block boot).
export function sanitizeConfig(raw) {
  const out = { ...DEFAULT_CONFIG };
  if (raw && typeof raw === 'object') for (const k of Object.keys(RULES)) if (k in raw && RULES[k](raw[k])) out[k] = raw[k];
  return out;
}

// Strict version for user changes: throws on any invalid key.
export function validatePatch(patch) {
  if (!patch || typeof patch !== 'object') throw new TypeError('Config patch must be an object');
  for (const [k, v] of Object.entries(patch)) {
    if (!RULES[k]) throw new RangeError(`Unknown setting "${k}"`);
    if (!RULES[k](v)) throw new RangeError(`Invalid value for "${k}"`);
  }
  return patch;
}
