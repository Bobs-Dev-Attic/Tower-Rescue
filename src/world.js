import * as THREE from '../vendor/three.module.js';
import { fbm, clamp, lerp, rng } from './util.js';

// Terrain heightfield + city of destructible skyscrapers + helipads.
// Layout: flat city in the middle/east, mountain ridge to the north,
// terrain falls below sea level to the west (ocean).

const CITY = { x0: -70, x1: 150, z0: -50, z1: 150 };

export function terrainHeight(x, z) {
  let h = 5 * fbm(x * 0.012 + 3.7, z * 0.012 + 9.1, 3);
  // mountains north
  const m = clamp((-z - 90) / 110, 0, 1);
  h += m * m * (26 + 60 * fbm(x * 0.02 + 5, z * 0.02, 4));
  // ocean west
  const o = clamp((-x - 150) / 70, 0, 1);
  h = lerp(h, -10, o * o * (3 - 2 * o));
  // flatten the city district
  const inx = clamp((x - CITY.x0) / 25, 0, 1) * clamp((CITY.x1 - x) / 25, 0, 1);
  const inz = clamp((z - CITY.z0) / 25, 0, 1) * clamp((CITY.z1 - z) / 25, 0, 1);
  h = lerp(h, 2, Math.min(1, inx * inz * 4));
  return h;
}

function flatBox(w, h, d, color) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color, flatShading: true })
  );
}

export class World {
  constructor(scene, fireSystem) {
    this.scene = scene;
    this.fires = fireSystem;
    this.terrainHeight = terrainHeight;
    this.buildings = [];
    this.debris = [];
    this.onCollapse = null; // callback(building)
    const rand = rng(20260713);

    this._buildTerrain();
    this._buildCity(rand);
    this._buildProps(rand);
    this._buildPads();
  }

  _buildTerrain() {
    const size = 800, seg = 110;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      if (h < 0.6) c.setHex(0xc9b47c);            // beach sand
      else if (h < 18) c.setHex(0x4a7c3a);        // grass
      else if (h < 42) c.setHex(0x6b6f5e);        // rock
      else c.setHex(0xe8ecef);                     // snow caps
      c.offsetHSL(0, 0, (fbm(x * 0.1, z * 0.1, 2) - 0.5) * 0.06);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      vertexColors: true, flatShading: true,
    }));
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  _buildCity(rand) {
    const winTexMat = (base) => new THREE.MeshLambertMaterial({ color: base, flatShading: true });
    const palette = [0x8fa6b8, 0x7d8ea3, 0xa3958a, 0x93a89b, 0x6f7f95, 0xb0a48e];
    const grid = 34;
    for (let gx = CITY.x0 + 20; gx < CITY.x1 - 15; gx += grid) {
      for (let gz = CITY.z0 + 20; gz < CITY.z1 - 15; gz += grid) {
        if (rand() < 0.22) continue;                    // leave plazas
        const w = 10 + rand() * 8, d = 10 + rand() * 8;
        const h = 22 + rand() * 65;
        const x = gx + (rand() - 0.5) * 8, z = gz + (rand() - 0.5) * 8;
        const y0 = terrainHeight(x, z);
        const body = flatBox(w, h, d, palette[(rand() * palette.length) | 0]);
        body.position.set(x, y0 + h / 2, z);
        body.castShadow = body.receiveShadow = true;
        // emissive window strips (cheap "lit floors" look)
        const strips = new THREE.Mesh(
          new THREE.BoxGeometry(w * 1.01, h * 0.92, d * 1.01, 1, Math.max(3, (h / 7) | 0), 1),
          new THREE.MeshBasicMaterial({ color: 0xffe9a8, wireframe: true, transparent: true, opacity: 0.12 })
        );
        strips.position.y = 0;
        body.add(strips);
        this.scene.add(body);

        const b = {
          mesh: body, x, z, w, d, h, baseY: y0,
          min: new THREE.Vector3(x - w / 2, y0, z - d / 2),
          max: new THREE.Vector3(x + w / 2, y0 + h, z + d / 2),
          roofY: y0 + h,
          burning: false, hp: 100, collapsed: false, emitters: [],
          shake: 0,
        };
        this.buildings.push(b);
      }
    }
  }

  _buildProps(rand) {
    // low-poly trees on the hills & mountain foot
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.6, 3, 5);
    const crownGeo = new THREE.ConeGeometry(2.6, 6, 6);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2b, flatShading: true });
    const crownMat = new THREE.MeshLambertMaterial({ color: 0x2f6b33, flatShading: true });
    const trees = new THREE.Group();
    let placed = 0, tries = 0;
    while (placed < 90 && tries++ < 600) {
      const x = (rand() - 0.5) * 640, z = (rand() - 0.5) * 640;
      const h = terrainHeight(x, z);
      if (h < 2 || h > 34) continue;
      if (x > CITY.x0 - 10 && x < CITY.x1 + 10 && z > CITY.z0 - 10 && z < CITY.z1 + 10) continue;
      const t = new THREE.Mesh(trunkGeo, trunkMat);
      const cr = new THREE.Mesh(crownGeo, crownMat);
      t.position.set(x, h + 1.5, z);
      cr.position.set(x, h + 6, z);
      const s = 0.7 + rand() * 0.9;
      t.scale.setScalar(s); cr.scale.setScalar(s);
      trees.add(t, cr);
      placed++;
    }
    this.scene.add(trees);
  }

  _padMesh(color, letter) {
    const g = new THREE.Group();
    const disk = new THREE.Mesh(
      new THREE.CylinderGeometry(9, 9.5, 1, 18),
      new THREE.MeshLambertMaterial({ color: 0x3a4652, flatShading: true })
    );
    g.add(disk);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(7, 0.35, 6, 24),
      new THREE.MeshBasicMaterial({ color })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.55;
    g.add(ring);
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
    ctx.font = 'bold 100px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, 64, 70);
    const tex = new THREE.CanvasTexture(c);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
    label.rotation.x = -Math.PI / 2;
    label.position.y = 0.56;
    g.add(label);
    return g;
  }

  _buildPads() {
    // Base pad (spawn / refuel) south of the city, hospital pad on the east side.
    const bx = 40, bz = 175;
    const by = terrainHeight(bx, bz) + 0.5;
    const base = this._padMesh(0xffd76a, 'B');
    base.position.set(bx, by, bz);
    this.scene.add(base);
    this.basePad = { x: bx, y: by + 0.5, z: bz, r: 10 };

    const hx = 185, hz = 60;
    const hy = terrainHeight(hx, hz) + 0.5;
    const hosp = this._padMesh(0xff5f6d, 'H');
    hosp.position.set(hx, hy, hz);
    // little hospital block beside the pad
    const block = flatBox(18, 10, 14, 0xd8dde2);
    block.position.set(hx + 20, hy + 5, hz);
    const cross = flatBox(6, 2, 0.6, 0xff5f6d);
    cross.position.set(hx + 20, hy + 11, hz + 7);
    const cross2 = flatBox(2, 6, 0.6, 0xff5f6d);
    cross2.position.copy(cross.position);
    this.scene.add(hosp, block, cross, cross2);
    this.hospitalPad = { x: hx, y: hy + 0.5, z: hz, r: 10 };
  }

  // ---- fire & collapse -------------------------------------------------

  igniteBuilding(b) {
    if (b.burning || b.collapsed) return;
    b.burning = true;
    const floors = 2 + (Math.random() * 2) | 0;
    for (let i = 0; i < floors; i++) {
      const fy = b.baseY + b.h * (0.35 + 0.5 * (i / floors));
      const e = this.fires.spawn(
        new THREE.Vector3(b.x + (Math.random() - 0.5) * b.w * 0.5, fy,
                          b.z + (Math.random() - 0.5) * b.d * 0.5),
        { radius: Math.min(b.w, b.d) * 0.4, count: 60 }
      );
      b.emitters.push(e);
    }
  }

  collapseBuilding(b) {
    if (b.collapsed) return;
    b.collapsed = true;
    b.burning = false;
    for (const e of b.emitters) e.extinguish();
    if (this.onCollapse) this.onCollapse(b);

    // spawn tumbling debris chunks
    const mat = new THREE.MeshLambertMaterial({ color: 0x5a5f66, flatShading: true });
    const n = 16;
    for (let i = 0; i < n; i++) {
      const s = 1.5 + Math.random() * 3.5;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * (0.6 + Math.random()), s), mat);
      m.position.set(
        b.x + (Math.random() - 0.5) * b.w,
        b.baseY + b.h * (0.25 + Math.random() * 0.75),
        b.z + (Math.random() - 0.5) * b.d
      );
      this.scene.add(m);
      this.debris.push({
        mesh: m,
        vel: new THREE.Vector3((Math.random() - 0.5) * 9, Math.random() * 3, (Math.random() - 0.5) * 9),
        ang: new THREE.Vector3(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2),
        life: 7 + Math.random() * 3,
        settled: false,
      });
    }
    // dust cloud reusing the fire particle system (grey, short lived)
    const dust = this.fires.spawn(new THREE.Vector3(b.x, b.baseY + 2, b.z),
      { radius: Math.max(b.w, b.d) * 0.9, count: 50 });
    dust.light.intensity = 0;
    setTimeout(() => dust.extinguish(), 2500);
  }

  update(dt) {
    // burning buildings lose structure; shake before collapsing
    for (const b of this.buildings) {
      if (b.collapsed) {
        // sink the husk into the ground during the first second after collapse
        if (b.mesh.position.y > b.baseY - b.h / 2 + 1.2) {
          b.mesh.position.y -= dt * b.h * 0.8;
          b.mesh.rotation.z += dt * (Math.random() - 0.5) * 0.2;
          b.mesh.scale.multiplyScalar(Math.max(0.2, 1 - dt * 0.5));
        } else if (b.mesh.parent) {
          this.scene.remove(b.mesh);
          // rubble mound stays as a soft collision at 15 % height
          b.max.y = b.baseY + Math.min(4, b.h * 0.12);
        }
        continue;
      }
      if (!b.burning) continue;
      b.hp -= dt * 2.2;
      if (b.hp < 30) {
        b.shake = (30 - b.hp) / 30;
        b.mesh.position.x = b.x + (Math.random() - 0.5) * b.shake * 0.7;
        b.mesh.position.z = b.z + (Math.random() - 0.5) * b.shake * 0.7;
      }
      if (b.hp <= 0) this.collapseBuilding(b);
    }

    // debris rigid-body-lite integration
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        this.debris.splice(i, 1);
        continue;
      }
      if (!d.settled) {
        d.vel.y -= 22 * dt;
        d.mesh.position.addScaledVector(d.vel, dt);
        d.mesh.rotation.x += d.ang.x * dt;
        d.mesh.rotation.y += d.ang.y * dt;
        d.mesh.rotation.z += d.ang.z * dt;
        const g = terrainHeight(d.mesh.position.x, d.mesh.position.z) + 0.8;
        if (d.mesh.position.y < g) {
          d.mesh.position.y = g;
          if (Math.abs(d.vel.y) > 4) {
            d.vel.y = -d.vel.y * 0.3;                // bounce
            d.vel.x *= 0.6; d.vel.z *= 0.6;
            d.ang.multiplyScalar(0.5);
          } else {
            d.settled = true;
          }
        }
      } else if (d.life < 1.5) {
        d.mesh.position.y -= dt * 1.5;               // sink away
      }
    }
  }

  // AABB test used by heli & winch. Returns the building penetrated, or null.
  buildingAt(p, pad = 0) {
    for (const b of this.buildings) {
      if (p.x > b.min.x - pad && p.x < b.max.x + pad &&
          p.z > b.min.z - pad && p.z < b.max.z + pad &&
          p.y > b.min.y && p.y < b.max.y + pad) return b;
    }
    return null;
  }
}
