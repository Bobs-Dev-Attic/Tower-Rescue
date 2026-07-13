// Thin DOM layer: gauges, counters, wind indicator, timed messages.

export class HUD {
  constructor() {
    this.score = document.getElementById('score');
    this.aboard = document.getElementById('aboard');
    this.lost = document.getElementById('lost');
    this.fuel = document.querySelector('#fuelbar i');
    this.hull = document.querySelector('#hullbar i');
    this.windArrow = document.getElementById('windarrow');
    this.windSpd = document.getElementById('windspd');
    this.alt = document.getElementById('alt');
    this.msg = document.getElementById('msg');
    this._msgTimer = 0;
  }

  message(text, seconds = 3) {
    this.msg.textContent = text;
    this.msg.style.opacity = 1;
    this._msgTimer = seconds;
  }

  update(dt, { heli, weather, rescued, lost, camYaw }) {
    this.fuel.style.width = (heli.fuel * 100).toFixed(0) + '%';
    this.hull.style.width = (heli.hull * 100).toFixed(0) + '%';
    this.score.textContent = rescued;
    this.aboard.textContent = heli.aboard;
    this.lost.textContent = lost;
    const w = weather.wind;
    const ang = Math.atan2(w.z, w.x) - camYaw;
    this.windArrow.style.transform = `rotate(${(ang * 180 / Math.PI).toFixed(0)}deg)`;
    this.windSpd.textContent = w.length().toFixed(0) + ' m/s' + (weather.rain > 0.3 ? ' 🌧' : '');
    const agl = heli.pos.y - heli.world.terrainHeight(heli.pos.x, heli.pos.z);
    this.alt.textContent = 'ALT ' + Math.max(0, agl).toFixed(0) + ' m';

    if (this._msgTimer > 0) {
      this._msgTimer -= dt;
      if (this._msgTimer <= 0) this.msg.style.opacity = 0;
    }
  }
}
