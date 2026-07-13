import * as THREE from '../vendor/three.module.js';

// Ocean: CPU-displaced grid using a sum of Gerstner waves.
// waveHeight(x, z) is the same math, so rafts / swimmers / the helicopter
// interact with the exact surface that is rendered.

const WAVES = [
  // dirX, dirZ, amplitude, wavelength, speed
  [1.0, 0.15, 0.9, 46, 5.2],
  [0.7, 0.7, 0.55, 27, 4.0],
  [-0.2, 1.0, 0.32, 15, 3.1],
  [0.9, -0.5, 0.18, 8, 2.4],
];

export class Ocean {
  constructor(scene, { level = 0, size = 900, segments = 96, shoreX = -145 } = {}) {
    this.level = level;
    this.time = 0;
    this.storm = 1; // multiplier raised by weather during rain
    this.shoreX = shoreX; // no water east of this line

    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    this.geo = geo;
    this.basePos = geo.attributes.position.array.slice();

    const mat = new THREE.MeshPhongMaterial({
      color: 0x1a5f8a,
      emissive: 0x06283d,
      specular: 0x88bbdd,
      shininess: 60,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = level;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  // Analytic wave height at world (x,z) — used for physics/buoyancy.
  // East of the shoreline there is no water at all.
  waveHeight(x, z, t = this.time) {
    if (x > this.shoreX) return this.level - 50;
    let y = 0;
    const s = this.storm;
    for (const [dx, dz, amp, len, spd] of WAVES) {
      const k = (Math.PI * 2) / len;
      const d = (x * dx + z * dz) / Math.hypot(dx, dz);
      y += amp * s * Math.sin(d * k + t * spd * k);
    }
    return this.level + y;
  }

  update(dt) {
    this.time += dt;
    const pos = this.geo.attributes.position;
    const base = this.basePos;
    const t = this.time, s = this.storm;
    const ox = this.mesh.position.x, oz = this.mesh.position.z;
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3], bz = base[i * 3 + 2];
      const wx = bx + ox, wz = bz + oz;
      let y = 0, sx = 0, sz = 0;
      for (const [dx, dz, amp, len, spd] of WAVES) {
        const il = 1 / Math.hypot(dx, dz);
        const k = (Math.PI * 2) / len;
        const ph = (wx * dx + wz * dz) * il * k + t * spd * k;
        const a = amp * s;
        y += a * Math.sin(ph);
        // Gerstner horizontal displacement -> sharper crests
        const q = 0.35 * a;
        sx += q * dx * il * Math.cos(ph);
        sz += q * dz * il * Math.cos(ph);
      }
      pos.array[i * 3] = bx + sx;
      pos.array[i * 3 + 1] = y;
      pos.array[i * 3 + 2] = bz + sz;
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
