import * as THREE from '../vendor/three.module.js';
import { noise2, clamp } from './util.js';

// Wind, gusts, rain and the vertical air-current field.
// windAt() and updraftAt() are sampled by the helicopter, fire smoke,
// rain streaks and the ocean storm factor.

export class Weather {
  constructor(scene, { terrainHeight, fireSystem }) {
    this.scene = scene;
    this.terrainHeight = terrainHeight;
    this.fires = fireSystem;
    this.time = Math.random() * 500;
    this.wind = new THREE.Vector3(3, 0, 1);
    this.rain = 0;          // 0..1 current rain amount
    this._rainTarget = 0;
    this._nextWeatherFlip = 20 + Math.random() * 20;

    // Rain streaks: one Points cloud recycled around the camera target.
    const N = 900;
    this.rainCount = N;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 160;
      pos[i * 3 + 1] = Math.random() * 90;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 160;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x9db8d9, size: 2.2, transparent: true, opacity: 0,
      depthWrite: false, sizeAttenuation: false, // pixel-sized: ortho camera
    }));
    this.rainPoints.frustumCulled = false;
    scene.add(this.rainPoints);
  }

  // Horizontal wind (world-space) at a position; strength rises with altitude.
  windAt(pos, out = new THREE.Vector3()) {
    const altBoost = 1 + clamp(pos.y / 120, 0, 1) * 0.8;
    const gust = 1 + 0.5 * (noise2(this.time * 0.35, pos.x * 0.01 + pos.z * 0.01) - 0.5) * 2;
    return out.copy(this.wind).multiplyScalar(altBoost * gust);
  }

  // Vertical air speed: fire thermals, mountain slope lift, sink over water in storms.
  updraftAt(pos) {
    let up = 0;
    // fire thermal columns (strong just above fires, fading with height)
    const heat = this.fires.heatAt(pos.x, pos.z);
    up += clamp(heat, 0, 14) * clamp(1 - (pos.y - 20) / 160, 0.15, 1);
    // orographic lift: wind pushed up windward slopes
    const e = 4;
    const h0 = this.terrainHeight(pos.x, pos.z);
    const hW = this.terrainHeight(pos.x + this.wind.x * e * 0.2, pos.z + this.wind.z * e * 0.2);
    const slopeAlong = (hW - h0) / e; // >0 means terrain rises downwind of us -> lift here
    if (h0 > 4 && pos.y - h0 < 60) up += clamp(slopeAlong * this.wind.length() * 1.6, -6, 9);
    // storm downdrafts / turbulence
    up += (noise2(pos.x * 0.02 + this.time * 0.3, pos.z * 0.02) - 0.5) * (2 + this.rain * 8);
    return up;
  }

  update(dt, focus /* Vector3 camera target */, ocean) {
    this.time += dt;

    // Slowly wandering wind direction & speed; storms mean stronger wind.
    const dirN = noise2(this.time * 0.02, 7.3) * Math.PI * 4;
    const spd = 2 + noise2(this.time * 0.05, 91.2) * 7 + this.rain * 6;
    this.wind.set(Math.cos(dirN) * spd, 0, Math.sin(dirN) * spd);

    // Weather cycle: flip between clear and rain every 20-60 s.
    this._nextWeatherFlip -= dt;
    if (this._nextWeatherFlip <= 0) {
      this._rainTarget = this._rainTarget > 0.5 ? 0 : 0.6 + Math.random() * 0.4;
      this._nextWeatherFlip = 25 + Math.random() * 35;
    }
    this.rain += clamp(this._rainTarget - this.rain, -dt * 0.12, dt * 0.12);
    if (ocean) ocean.storm = 1 + this.rain * 1.1;

    // Rain particles fall around the focus point, sheared by wind.
    const mat = this.rainPoints.material;
    mat.opacity = this.rain * 0.75;
    if (this.rain > 0.02) {
      const pos = this.rainPoints.geometry.attributes.position;
      const arr = pos.array;
      const fall = 55 * dt;
      for (let i = 0; i < this.rainCount; i++) {
        arr[i * 3] += this.wind.x * dt * 1.4;
        arr[i * 3 + 1] -= fall;
        arr[i * 3 + 2] += this.wind.z * dt * 1.4;
        if (arr[i * 3 + 1] < focus.y - 15) {
          arr[i * 3] = focus.x + (Math.random() - 0.5) * 160;
          arr[i * 3 + 1] = focus.y + 60 + Math.random() * 30;
          arr[i * 3 + 2] = focus.z + (Math.random() - 0.5) * 160;
        }
      }
      pos.needsUpdate = true;
      this.rainPoints.visible = true;
    } else {
      this.rainPoints.visible = false;
    }
  }
}
