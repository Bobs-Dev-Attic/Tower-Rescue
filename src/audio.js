// Procedural rotor sound: filtered noise "whomp" amplitude-modulated at
// blade-pass frequency + a low engine hum. No audio assets needed.

export class RotorAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    // noise source for blade chop
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf; noise.loop = true;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 220;

    this.chopGain = ctx.createGain(); this.chopGain.gain.value = 0;
    // LFO gates the noise at blade-pass rate -> whomp whomp
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'triangle'; this.lfo.frequency.value = 0.1;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5;
    const lfoOffset = ctx.createConstantSource(); lfoOffset.offset.value = 0.5;
    const gate = ctx.createGain(); gate.gain.value = 0;
    this.lfo.connect(lfoGain).connect(gate.gain);
    lfoOffset.connect(gate.gain);

    // engine hum
    this.hum = ctx.createOscillator();
    this.hum.type = 'sawtooth'; this.hum.frequency.value = 30;
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0;

    const master = ctx.createGain(); master.gain.value = 0.5;
    noise.connect(lp).connect(gate).connect(this.chopGain).connect(master);
    this.hum.connect(this.humGain).connect(master);
    master.connect(ctx.destination);

    noise.start(); this.lfo.start(); lfoOffset.start(); this.hum.start();
  }

  update(rotorSpeed, collective) {
    if (!this.started || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const bladePass = 1 + rotorSpeed * 12 + collective * 3;
    this.lfo.frequency.setTargetAtTime(bladePass, t, 0.1);
    this.chopGain.gain.setTargetAtTime(rotorSpeed * 0.55, t, 0.15);
    this.hum.frequency.setTargetAtTime(24 + rotorSpeed * 34, t, 0.1);
    this.humGain.gain.setTargetAtTime(rotorSpeed * 0.12, t, 0.15);
  }
}
