// Adjustable realism settings — shared multipliers the flight-model reads live.
// Sliders in the settings panel mutate this object; Weather scales its wind,
// gust and updraft output by these factors every frame, so changes apply
// instantly without restarting the sim. Persisted to localStorage.

const KEY = 'towerRescue.realism.v1';

// Each realism knob: a multiplier around 1.0 (= the tuned default baseline).
export const settings = {
  wind: 1,       // horizontal wind strength
  gusts: 1,      // gust / turbulence amplitude
  thermals: 1,   // vertical air currents (thermals, slope lift, downdrafts)
};

// Named presets the panel exposes as one-tap buttons.
export const PRESETS = {
  calm:      { wind: 0.35, gusts: 0.25, thermals: 0.4 },
  realistic: { wind: 1,    gusts: 1,    thermals: 1 },
  extreme:   { wind: 1.8,  gusts: 1.8,  thermals: 1.6 },
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const k of Object.keys(settings)) {
        if (typeof saved[k] === 'number' && isFinite(saved[k])) settings[k] = saved[k];
      }
    }
  } catch (_) { /* ignore corrupt/blocked storage */ }
  return settings;
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (_) { /* ignore */ }
}

export function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  Object.assign(settings, p);
  saveSettings();
}
