// Animated cockpit instrument cluster drawn on a single canvas each frame:
//   ATT  — artificial horizon (pitch + roll)
//   HDG  — rotating compass card (yaw); north = -z (toward the mountains)
//   ALT  — altimeter needle + digital, metres AGL
//   SPD  — airspeed needle + digital, m/s ground-relative
//   FUEL — needle + digital pounds remaining

export const FUEL_CAPACITY_LBS = 1200;

const FACE = '#101820';
const BEZEL = 'rgba(150,195,240,0.5)';
const TICK = '#cfe2f5';
const NEEDLE = '#ffd76a';
const TXT = '#eaf4ff';

export class Instruments {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.r = 36;                       // gauge radius in canvas px
    this.cy = canvas.height / 2;
    const n = 5;
    const spacing = canvas.width / n;
    this.cx = Array.from({ length: n }, (_, i) => spacing * (i + 0.5));
  }

  update({ pitch, roll, heading, alt, speed, fuelLbs }) {
    const g = this.ctx;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._attitude(this.cx[0], pitch, roll);
    this._compass(this.cx[1], heading);
    this._needleGauge(this.cx[2], 'ALT', alt, 0, 150, 'm');
    this._needleGauge(this.cx[3], 'SPD', speed, 0, 40, 'm/s');
    this._fuel(this.cx[4], fuelLbs);
  }

  _face(cx, label) {
    const g = this.ctx, r = this.r;
    g.beginPath();
    g.arc(cx, this.cy, r, 0, Math.PI * 2);
    g.fillStyle = FACE;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = BEZEL;
    g.stroke();
    if (label) {
      g.fillStyle = 'rgba(200,225,255,0.55)';
      g.font = '7px sans-serif';
      g.textAlign = 'center';
      g.fillText(label, cx, this.cy + r - 6);
    }
  }

  // -------- artificial horizon: pitch shifts it, roll rotates it --------
  _attitude(cx, pitch, roll) {
    const g = this.ctx, r = this.r, cy = this.cy;
    this._face(cx);
    g.save();
    g.beginPath();
    g.arc(cx, cy, r - 3, 0, Math.PI * 2);
    g.clip();
    g.translate(cx, cy);
    g.rotate(roll);
    // nose down (positive pitch) -> horizon rises on the gauge (canvas -y)
    const off = (-pitch / 0.6) * r;    // ±0.6 rad spans the gauge
    g.fillStyle = '#3f74ad';           // sky
    g.fillRect(-r, -r * 2 + off, r * 2, r * 2);
    g.fillStyle = '#7a5a33';           // ground
    g.fillRect(-r, off, r * 2, r * 2);
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(-r, off); g.lineTo(r, off); g.stroke();
    // pitch ladder
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    for (const step of [-2, -1, 1, 2]) {
      const y = off + step * r * 0.29;
      g.beginPath(); g.moveTo(-7, y); g.lineTo(7, y); g.stroke();
    }
    g.restore();
    // fixed aircraft symbol
    g.strokeStyle = '#ffb347';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(cx - 13, cy); g.lineTo(cx - 4, cy); g.lineTo(cx, cy + 4); g.lineTo(cx + 4, cy); g.lineTo(cx + 13, cy);
    g.stroke();
    this._face2(cx, 'ATT');
  }

  // label drawn after content so it stays readable
  _face2(cx, label) {
    const g = this.ctx;
    g.fillStyle = 'rgba(234,244,255,0.8)';
    g.font = '7px sans-serif';
    g.textAlign = 'center';
    g.fillText(label, cx, this.cy + this.r - 5);
  }

  // -------- rotating compass card, fixed lubber line at 12 o'clock --------
  _compass(cx, heading) {
    const g = this.ctx, r = this.r, cy = this.cy;
    this._face(cx);
    g.save();
    g.translate(cx, cy);
    g.rotate(-heading);
    g.fillStyle = TICK;
    g.strokeStyle = TICK;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 30) {
      const a = (d * Math.PI) / 180;
      g.save();
      g.rotate(a);
      if (d % 90 === 0) {
        g.font = 'bold 9px sans-serif';
        g.fillStyle = d === 0 ? '#ff6b5e' : TICK;
        g.fillText('NESW'[d / 90], 0, -r + 11);
      } else {
        g.beginPath(); g.moveTo(0, -r + 4); g.lineTo(0, -r + 9); g.lineWidth = 1; g.stroke();
      }
      g.restore();
    }
    g.restore();
    // fixed helicopter arrow
    g.fillStyle = NEEDLE;
    g.beginPath();
    g.moveTo(cx, cy - 10); g.lineTo(cx - 5, cy + 7); g.lineTo(cx, cy + 3); g.lineTo(cx + 5, cy + 7);
    g.closePath(); g.fill();
    this._face2(cx, 'HDG');
  }

  // -------- 240°-sweep needle gauge with digital readout --------
  _needleGauge(cx, label, value, min, max, unit) {
    const g = this.ctx, r = this.r, cy = this.cy;
    this._face(cx, label);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;   // sweep
    g.strokeStyle = TICK;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i <= 5; i++) {
      const a = a0 + ((a1 - a0) * i) / 5;
      g.lineWidth = i % 5 === 0 ? 2 : 1;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      g.lineTo(cx + Math.cos(a) * (r - 9), cy + Math.sin(a) * (r - 9));
      g.stroke();
      g.font = '6px sans-serif';
      g.fillStyle = 'rgba(207,226,245,0.7)';
      g.fillText(String(Math.round(min + ((max - min) * i) / 5)),
        cx + Math.cos(a) * (r - 15), cy + Math.sin(a) * (r - 15));
    }
    const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
    const a = a0 + (a1 - a0) * t;
    g.strokeStyle = NEEDLE;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10));
    g.stroke();
    g.fillStyle = NEEDLE;
    g.beginPath(); g.arc(cx, cy, 2.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = TXT;
    g.font = 'bold 8px sans-serif';
    g.fillText(`${Math.round(value)}${unit}`, cx, cy + 13);
  }

  // -------- fuel: 240° needle, red arc for reserve, pounds readout --------
  _fuel(cx, lbs) {
    const g = this.ctx, r = this.r, cy = this.cy;
    this._face(cx, 'FUEL');
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    // red reserve arc (bottom 15 %)
    g.strokeStyle = 'rgba(255,95,109,0.8)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, r - 6, a0, a0 + (a1 - a0) * 0.15);
    g.stroke();
    g.fillStyle = 'rgba(207,226,245,0.8)';
    g.font = 'bold 7px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('E', cx + Math.cos(a0) * (r - 14), cy + Math.sin(a0) * (r - 14));
    g.fillText('F', cx + Math.cos(a1) * (r - 14), cy + Math.sin(a1) * (r - 14));
    const t = Math.min(1, Math.max(0, lbs / FUEL_CAPACITY_LBS));
    const a = a0 + (a1 - a0) * t;
    g.strokeStyle = t < 0.15 ? '#ff5f6d' : NEEDLE;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10));
    g.stroke();
    g.fillStyle = NEEDLE;
    g.beginPath(); g.arc(cx, cy, 2.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = TXT;
    g.font = 'bold 8px sans-serif';
    g.fillText(`${Math.round(lbs)} lbs`, cx, cy + 13);
  }
}
