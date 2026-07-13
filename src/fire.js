import * as THREE from '../vendor/three.module.js';

// Pooled particle fire + smoke. Each FireEmitter is one THREE.Points cloud.
// Fire intensity feeds the weather system (thermal updrafts) and is damped
// by rain. Emitters attach to building floors and spread upward over time.

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,220,140,0.85)');
  grad.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

let glowTex = null;

export class FireEmitter {
  constructor(scene, position, { radius = 3, count = 70, smoke = true } = {}) {
    glowTex ||= makeGlowTexture();
    this.position = position.clone();
    this.radius = radius;
    this.intensity = 1;      // 0..1, weather rain reduces it
    this.alive = true;
    this.count = count;

    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    this.age = new Float32Array(count);
    this.life = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    this.isSmoke = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      this._respawn(i, pos, col, Math.random() * 1.4, smoke && i % 3 === 0);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // NOTE: sizeAttenuation would shrink points to subpixels under the
    // orthographic iso camera, so size is in raw pixels here.
    const mat = new THREE.PointsMaterial({
      size: 26,
      map: glowTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.light = new THREE.PointLight(0xff7722, 12, 40, 1.8);
    this.light.position.copy(position).add(new THREE.Vector3(0, 2, 0));
    scene.add(this.light);
    this._flicker = Math.random() * 10;
  }

  _respawn(i, pos, col, age = 0, smoke = this.isSmoke[i]) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * this.radius;
    pos[i * 3] = this.position.x + Math.cos(a) * r;
    pos[i * 3 + 1] = this.position.y + Math.random() * 0.5;
    pos[i * 3 + 2] = this.position.z + Math.sin(a) * r;
    this.isSmoke[i] = smoke ? 1 : 0;
    this.age[i] = age;
    this.life[i] = smoke ? 2.5 + Math.random() * 2 : 0.9 + Math.random() * 0.8;
    this.vel[i * 3] = (Math.random() - 0.5) * 1.2;
    this.vel[i * 3 + 1] = smoke ? 4 + Math.random() * 3 : 5 + Math.random() * 4;
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
    if (smoke) {
      const g = 0.12 + Math.random() * 0.1;
      col[i * 3] = g; col[i * 3 + 1] = g; col[i * 3 + 2] = g;
    } else {
      col[i * 3] = 1; col[i * 3 + 1] = 0.8; col[i * 3 + 2] = 0.3;
    }
  }

  update(dt, wind) {
    const posAttr = this.points.geometry.attributes.position;
    const colAttr = this.points.geometry.attributes.color;
    const pos = posAttr.array, col = colAttr.array;
    const inten = this.intensity;
    for (let i = 0; i < this.count; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        if (!this.alive || (Math.random() > inten && !this.isSmoke[i])) {
          // starved particle: park far below (invisible)
          pos[i * 3 + 1] = -9999;
          this.age[i] = -Math.random() * 2; // retry later
          continue;
        }
        this._respawn(i, pos, col);
        continue;
      }
      if (this.age[i] < 0) continue;
      const t = this.age[i] / this.life[i];
      const smoke = this.isSmoke[i];
      pos[i * 3] += (this.vel[i * 3] + wind.x * (smoke ? 0.9 : 0.35)) * dt;
      pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += (this.vel[i * 3 + 2] + wind.z * (smoke ? 0.9 : 0.35)) * dt;
      if (smoke) {
        const g = 0.16 * (1 - t) + 0.04;
        col[i * 3] = g; col[i * 3 + 1] = g; col[i * 3 + 2] = g;
      } else {
        // white-hot -> orange -> dark red
        col[i * 3] = 1 - t * 0.35;
        col[i * 3 + 1] = 0.85 * (1 - t) * inten + 0.05;
        col[i * 3 + 2] = 0.35 * (1 - t) * (1 - t) * inten;
      }
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    this._flicker += dt * 14;
    this.light.intensity = this.alive
      ? (9 + Math.sin(this._flicker) * 3 + Math.sin(this._flicker * 2.7) * 2) * inten
      : Math.max(0, this.light.intensity - dt * 8);
  }

  extinguish() { this.alive = false; }

  dispose(scene) {
    scene.remove(this.points, this.light);
    this.points.geometry.dispose();
  }
}

export class FireSystem {
  constructor(scene) {
    this.scene = scene;
    this.emitters = [];
  }
  spawn(position, opts) {
    const e = new FireEmitter(this.scene, position, opts);
    this.emitters.push(e);
    return e;
  }
  update(dt, wind, rainFactor) {
    for (const e of this.emitters) {
      if (e.alive) e.intensity = Math.max(0.25, 1 - rainFactor * 0.6);
      e.update(dt, wind);
    }
  }
  // Total heat near a point -> thermal updraft strength for the weather system.
  // Hard 45 m cutoff so distant fires don't blanket the map in lift.
  heatAt(x, z) {
    let h = 0;
    for (const e of this.emitters) {
      if (!e.alive) continue;
      const d2 = (e.position.x - x) ** 2 + (e.position.z - z) ** 2;
      if (d2 > 2000) continue;
      h += ((e.intensity * 700) / (d2 + 40)) * (1 - d2 / 2000);
    }
    return h;
  }
}
