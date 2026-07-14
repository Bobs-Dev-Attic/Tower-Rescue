// Wires the realism settings panel DOM to the shared `settings` object.
// Sliders write straight into `settings` (read live by the flight model),
// preset buttons snap all three at once, and everything persists.

import { settings, loadSettings, saveSettings, applyPreset, PRESETS } from './settings.js';

const KNOBS = ['wind', 'gusts', 'thermals'];

export function initSettingsPanel() {
  loadSettings();

  const overlay = document.getElementById('settings');
  const openBtn = document.getElementById('btnSettings');
  const closeBtn = document.getElementById('settingsClose');
  const presetWrap = document.getElementById('presets');

  const sliders = {
    wind: document.getElementById('optWind'),
    gusts: document.getElementById('optGusts'),
    thermals: document.getElementById('optThermals'),
  };
  const readouts = {
    wind: document.getElementById('optWindVal'),
    gusts: document.getElementById('optGustsVal'),
    thermals: document.getElementById('optThermalsVal'),
  };

  // Push current settings into the controls (called on load + after presets).
  const syncUI = () => {
    for (const k of KNOBS) {
      sliders[k].value = settings[k];
      readouts[k].textContent = Math.round(settings[k] * 100) + '%';
    }
    // Highlight a preset button only when every knob matches it exactly.
    for (const btn of presetWrap.children) {
      const p = PRESETS[btn.dataset.preset];
      const match = KNOBS.every((k) => Math.abs(settings[k] - p[k]) < 0.001);
      btn.classList.toggle('active', match);
    }
  };

  for (const k of KNOBS) {
    sliders[k].addEventListener('input', () => {
      settings[k] = parseFloat(sliders[k].value);
      readouts[k].textContent = Math.round(settings[k] * 100) + '%';
      saveSettings();
      syncUI();
    });
  }

  for (const btn of presetWrap.children) {
    btn.addEventListener('click', () => { applyPreset(btn.dataset.preset); syncUI(); });
  }

  openBtn.addEventListener('click', () => { syncUI(); overlay.classList.add('open'); });
  closeBtn.addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });

  syncUI();
}
