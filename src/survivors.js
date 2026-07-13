import * as THREE from '../vendor/three.module.js';
import { clamp } from './util.js';

// Low-poly people waiting for rescue. Three habitats:
//   'roof'     — on a burning building; lost when it collapses
//   'mountain' — stranded on a slope; patient but the clock still ticks
//   'sea'      — on a life raft, bobbing on the real wave function; can drown
// States: waiting -> hoisting (on the hook) -> aboard -> rescued | lost

function makePerson(shirt) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.4), mat(shirt));
  body.position.y = 1.0;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), mat(0xe8b88a));
  head.position.y = 1.75;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, 0.35), mat(0x33415c));
  legs.position.y = 0.28;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.85, 0.18), mat(shirt));
  armL.position.set(-0.5, 1.45, 0);
  armL.geometry.translate(0, -0.35, 0);
  const armR = armL.clone();
  armR.position.x = 0.5;
  g.add(body, head, legs, armL, armR);
  g.userData.arms = [armL, armR];
  return g;
}

function makeRaft() {
  const raft = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 1.9, 0.6, 8),
    new THREE.MeshLambertMaterial({ color: 0xf2762e, flatShading: true })
  );
  return raft;
}

export class Survivor {
  constructor(scene, kind, pos, timeLimit) {
    this.kind = kind;
    this.state = 'waiting';
    this.timeLeft = timeLimit;
    this.group = new THREE.Group();
    this.person = makePerson([0xd94f4f, 0x4fa3d9, 0xd9c34f, 0x9a4fd9][(Math.random() * 4) | 0]);
    this.group.add(this.person);
    if (kind === 'sea') {
      this.raft = makeRaft();
      this.raft.position.y = -0.1;
      this.group.add(this.raft);
    }
    this.group.position.copy(pos);
    scene.add(this.group);
    this._t = Math.random() * 10;

    // floating ⚠ marker so players can find them from the iso camera
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = '52px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff'; // white so material.color can tint it
    ctx.fillText('⚠', 32, 36);
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c), transparent: true, depthTest: false,
    }));
    this.marker.scale.setScalar(5);
    this.marker.position.y = 7;
    this.group.add(this.marker);
  }

  get position() { return this.group.position; }

  update(dt, ocean) {
    this._t += dt;
    if (this.state === 'waiting') {
      this.timeLeft -= dt;
      // frantic arm waving, more frantic as time runs out
      const urgency = clamp(2.5 - this.timeLeft / 20, 1, 3);
      const a = Math.sin(this._t * 6 * urgency) * 1.2 - 2.2;
      const [l, r] = this.person.userData.arms;
      l.rotation.z = a; r.rotation.z = -a;
      this.marker.material.opacity = 0.6 + Math.sin(this._t * 4) * 0.4;
      this.marker.material.color.setHSL(clamp(this.timeLeft / 60, 0, 0.33) * 0.33, 1, 0.55);
      if (this.kind === 'sea' && ocean) {
        // ride the actual wave surface, tilt with the local slope
        const p = this.group.position;
        const h = ocean.waveHeight(p.x, p.z);
        p.y = h - 0.15;
        const e = 1.2;
        this.group.rotation.x = (ocean.waveHeight(p.x, p.z + e) - h) / e * 0.7;
        this.group.rotation.z = -(ocean.waveHeight(p.x + e, p.z) - h) / e * 0.7;
        // rafts drift with the storm
        p.x += Math.sin(this._t * 0.1) * dt * (0.4 + ocean.storm * 0.4);
      }
    } else if (this.state === 'hoisting' || this.state === 'aboard') {
      const [l, r] = this.person.userData.arms;
      l.rotation.z = -0.4; r.rotation.z = 0.4; // hanging on
    }
  }

  attachToHook() {
    this.state = 'hoisting';
    if (this.raft) this.raft.visible = false;
    this.marker.visible = false;
    this.group.rotation.set(0, 0, 0);
  }

  lose(scene) {
    this.state = 'lost';
    scene.remove(this.group);
  }
  rescueComplete(scene) {
    this.state = 'rescued';
    scene.remove(this.group);
  }
}

export class SurvivorManager {
  constructor(scene, world, ocean) {
    this.scene = scene;
    this.world = world;
    this.ocean = ocean;
    this.list = [];
    this.rescued = 0;
    this.lost = 0;
    this.onEvent = null; // (type, survivor) => void  for HUD messages
    this._spawnTimer = 4;
  }

  spawnRoof() {
    const candidates = this.world.buildings.filter((b) => !b.collapsed && !b.hasSurvivor);
    if (!candidates.length) return null;
    const b = candidates[(Math.random() * candidates.length) | 0];
    b.hasSurvivor = true;
    this.world.igniteBuilding(b);
    const s = new Survivor(this.scene, 'roof',
      new THREE.Vector3(b.x, b.roofY, b.z), 999); // clock is the building's HP
    s.building = b;
    this.list.push(s);
    return s;
  }

  spawnMountain() {
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() - 0.5) * 500;
      const z = -120 - Math.random() * 180;
      const h = this.world.terrainHeight(x, z);
      if (h > 20 && h < 70) {
        const s = new Survivor(this.scene, 'mountain', new THREE.Vector3(x, h, z), 120);
        this.list.push(s);
        return s;
      }
    }
    return null;
  }

  spawnSea() {
    for (let i = 0; i < 40; i++) {
      const x = -190 - Math.random() * 130;
      const z = (Math.random() - 0.5) * 400;
      if (this.world.terrainHeight(x, z) < -4) {
        const s = new Survivor(this.scene, 'sea', new THREE.Vector3(x, 0, z), 90);
        this.list.push(s);
        return s;
      }
    }
    return null;
  }

  spawnSomewhere() {
    const active = this.list.filter((s) => s.state === 'waiting').length;
    if (active >= 6) return;
    const roll = Math.random();
    const s = roll < 0.45 ? this.spawnRoof() : roll < 0.72 ? this.spawnMountain() : this.spawnSea();
    if (s && this.onEvent) this.onEvent('spawn', s);
  }

  update(dt) {
    this._spawnTimer -= dt;
    if (this._spawnTimer <= 0) {
      this.spawnSomewhere();
      this._spawnTimer = 14 + Math.random() * 12;
    }
    for (const s of this.list) {
      if (s.state === 'waiting') {
        s.update(dt, this.ocean);
        // building collapsed under them, or drowned / exposure
        const collapsed = s.building && s.building.collapsed;
        if (collapsed || s.timeLeft <= 0) {
          s.lose(this.scene);
          this.lost++;
          if (this.onEvent) this.onEvent('lost', s);
        } else if (s.building) {
          s.position.x = s.building.mesh.position.x;
          s.position.z = s.building.mesh.position.z;
        }
      } else {
        s.update(dt, this.ocean);
      }
    }
    this.list = this.list.filter((s) => s.state !== 'lost' && s.state !== 'rescued');
  }

  // nearest waiting survivor to a point (for the winch hook)
  nearestWaiting(p, maxDist) {
    let best = null, bd = maxDist;
    for (const s of this.list) {
      if (s.state !== 'waiting') continue;
      const d = s.position.distanceTo(p);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
}
