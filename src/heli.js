import * as THREE from '../vendor/three.module.js';
import { clamp, lerp } from './util.js';

// Low-poly helicopter with a simplified but honest flight model:
//   thrust along the rotor axis (tilted by cyclic), gravity, quadratic drag,
//   attitude inertia, weathervane yaw damping, wind + updraft forces,
//   ground effect near surfaces, hard-impact damage and water ditching.

const G = 9.81;
const MAX_TILT = 0.42;          // rad, visual bank/pitch at full stick
const MAX_THRUST = 19;          // m/s^2 ceiling on rotor lift
const TILT_RESPONSE = 3.2;      // attitude follows input with lag (inertia)
const YAW_RATE = 1.9;
const MOVE_ACCEL = 14;          // m/s^2 horizontal at full cyclic stick
const DRAG_LIN = 0.12, DRAG_QUAD = 0.012;
const CRASH_SPEED = 12;         // m/s vertical/total impact that hurts

function buildHeliMesh() {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.7, 4.6), mat(0xe0392b));
  body.position.y = 0.2;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 1.2), mat(0x8fd3f4));
  nose.position.set(0, 0.35, 2.6);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 4.2), mat(0xe0392b));
  tail.position.set(0, 0.5, -4.0);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.5, 1.0), mat(0xf2c12e));
  fin.position.set(0, 1.2, -5.8);
  const skidL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 3.6), mat(0x333940));
  skidL.position.set(-1.1, -1.05, 0.3);
  const skidR = skidL.clone(); skidR.position.x = 1.1;
  const strut1 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 0.15), mat(0x333940));
  strut1.position.set(0, -0.75, 1.2);
  const strut2 = strut1.clone(); strut2.position.z = -0.8;

  const rotor = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 9.5), mat(0x2b2f33));
    blade.rotation.y = (i / 3) * Math.PI * 2;
    blade.position.y = 0.02 * i;
    rotor.add(blade);
  }
  rotor.position.set(0, 1.45, 0);
  // motion-blur disc: fades in as the rotor spools so the spin reads as fast
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(4.75, 24),
    new THREE.MeshBasicMaterial({ color: 0x353b41, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(0, 1.5, 0);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.7, 6), mat(0x2b2f33));
  mast.position.set(0, 1.15, 0);
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.0, 0.3), mat(0x2b2f33));
  tailRotor.position.set(0.45, 1.0, -5.8);

  g.add(body, nose, tail, fin, skidL, skidR, strut1, strut2, mast, rotor, disc, tailRotor);
  g.traverse((m) => { m.castShadow = true; });
  disc.castShadow = false;
  g.userData.rotor = rotor;
  g.userData.rotorDisc = disc;
  g.userData.tailRotor = tailRotor;
  return g;
}

export class Helicopter {
  constructor(scene, world, ocean, weather) {
    this.scene = scene;
    this.world = world;
    this.ocean = ocean;
    this.weather = weather;

    this.mesh = buildHeliMesh();
    scene.add(this.mesh);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.rotorSpeed = 0;             // 0..1 spool
    this.fuel = 1; this.hull = 1;
    this.landed = true;
    this.crashed = false;
    this.aboard = 0;
    this.capacity = 6;

    // winch
    this.winchOut = false;
    this.ropeLen = 0;
    this.ropeMax = 32;
    this.hookLoad = null;            // Survivor currently on the hook
    const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.ropeLine = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0xdddddd }));
    this.ropeLine.frustumCulled = false;
    scene.add(this.ropeLine);
    this.hook = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshLambertMaterial({ color: 0xf2c12e, flatShading: true })
    );
    scene.add(this.hook);

    // cheap blob shadow, shown only when the quality manager disables shadow maps
    this._blob = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
    );
    this._blob.rotation.x = -Math.PI / 2;
    this._blob.visible = false;
    this._blobEnabled = false;
    scene.add(this._blob);

    this.resetAtBase();
    this._wind = new THREE.Vector3();
  }

  setBlobShadow(on) {
    this._blobEnabled = on;
    this._blob.visible = on && !this.crashed;
  }

  resetAtBase() {
    const p = this.world.basePad;
    this.pos.set(p.x, p.y + 1.1, p.z);
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI; this.pitch = 0; this.roll = 0;
    this.rotorSpeed = 0;
    this.fuel = 1; this.hull = 1;
    this.landed = true; this.crashed = false;
    this.aboard = 0;
    this.winchOut = false; this.ropeLen = 0; this.hookLoad = null;
    this.mesh.visible = true;
    if (this._blob) this._blob.visible = this._blobEnabled;
  }

  get hookPos() {
    return new THREE.Vector3(this.pos.x, this.pos.y - 1.3 - this.ropeLen, this.pos.z);
  }

  update(dt, input, events, camYaw = Math.PI / 4) {
    if (this.crashed) return;

    // ----- rotor spool & fuel -----
    const wantSpin = this.fuel > 0 ? 1 : 0;
    this.rotorSpeed += clamp(wantSpin - this.rotorSpeed, -dt * 0.3, dt * 0.5);
    const rotor = this.mesh.userData.rotor;
    rotor.rotation.y += dt * 75 * this.rotorSpeed;
    this.mesh.userData.rotorDisc.material.opacity = this.rotorSpeed * 0.4;
    this.mesh.userData.tailRotor.rotation.x += dt * 90 * this.rotorSpeed;
    this.fuel = Math.max(0, this.fuel - dt * (0.0022 + 0.004 * Math.abs(input.collective)));

    // ----- camera-relative cyclic: stick-up moves up-screen -----
    // screen-right on the ground = (sin A, 0, -cos A); screen-up = (-cos A, 0, -sin A)
    const ca = Math.cos(camYaw), sa = Math.sin(camYaw);
    const mx = input.cyclicX * sa - input.cyclicY * ca;
    const mz = -input.cyclicX * ca - input.cyclicY * sa;

    // ----- attitude with inertia (visual: tilt into the acceleration) -----
    // positive rotateX = nose down, so accelerating toward the nose pitches forward
    const fwdAmt = mx * Math.sin(this.yaw) + mz * Math.cos(this.yaw);
    const rightAmt = mx * Math.cos(this.yaw) - mz * Math.sin(this.yaw);
    const tgtPitch = fwdAmt * MAX_TILT;
    const tgtRoll = -rightAmt * MAX_TILT;
    this.pitch += (tgtPitch - this.pitch) * TILT_RESPONSE * dt;
    this.roll += (tgtRoll - this.roll) * TILT_RESPONSE * dt;
    this.yaw -= input.yaw * YAW_RATE * dt;

    // ----- forces -----
    // Collective commands a climb/sink rate; the rotor works to hold it.
    // Max sink (8 m/s) stays under the crash threshold so full-down is a
    // firm landing, not a wreck. Updrafts/wind still perturb the hold.
    const vyGoal = (input.collective >= 0 ? input.collective * 11 : input.collective * 7.5) - 0.7;
    const lift = clamp(G + (vyGoal - this.vel.y) * 2.2, 0, MAX_THRUST) *
                 this.rotorSpeed * lerp(0.7, 1, this.hull);

    const airborneFactor = this.landed ? 0.25 : 1; // skids grip when parked
    const acc = new THREE.Vector3(
      mx * MOVE_ACCEL * this.rotorSpeed * airborneFactor,
      lift,
      mz * MOVE_ACCEL * this.rotorSpeed * airborneFactor
    );
    acc.y -= G;

    // wind & vertical air currents (boundary layer shelters a grounded heli)
    this.weather.windAt(this.pos, this._wind);
    const agl0 = this.pos.y - this._surfaceBelow();
    this._wind.multiplyScalar(clamp(agl0 / 8, 0.1, 1));
    const rel = this._wind.clone().sub(this.vel);
    acc.addScaledVector(rel, DRAG_LIN + DRAG_QUAD * rel.length());
    acc.y += this.weather.updraftAt(this.pos) * 0.55;

    // ground effect: extra lift within ~6 m of a surface
    const groundY = this._surfaceBelow();
    const agl = this.pos.y - groundY;
    if (agl < 7 && lift > 2 && input.collective > 0.05) acc.y += (1 - agl / 7) * 2.0;

    this.vel.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.vel, dt);

    // ----- collisions -----
    this._collide(dt, groundY, events);

    // ----- winch -----
    this._updateWinch(dt, input, events);

    // ----- write to mesh -----
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.rotateY(this.yaw);
    this.mesh.rotateX(this.pitch);
    this.mesh.rotateZ(this.roll);
    if (this._blob.visible) {
      this._blob.position.set(this.pos.x, groundY + 0.15, this.pos.z);
      const shrink = clamp(1.3 - agl / 120, 0.5, 1.3);
      this._blob.scale.setScalar(shrink);
    }
  }

  _surfaceBelow() {
    let g = this.world.terrainHeight(this.pos.x, this.pos.z);
    // building roofs count as ground when we're above them
    const b = this.world.buildingAt(new THREE.Vector3(this.pos.x, this.pos.y - 2, this.pos.z));
    if (b && this.pos.y > b.max.y - 2) g = Math.max(g, b.max.y);
    for (const pad of [this.world.basePad, this.world.hospitalPad]) {
      if (Math.hypot(this.pos.x - pad.x, this.pos.z - pad.z) < pad.r) g = Math.max(g, pad.y);
    }
    const w = this.ocean.waveHeight(this.pos.x, this.pos.z);
    if (w > g) g = w;
    return g;
  }

  _collide(dt, groundY, events) {
    const minY = groundY + 1.1; // skid height
    if (this.pos.y <= minY) {
      const impact = -this.vel.y;
      const overWater = this.ocean.waveHeight(this.pos.x, this.pos.z) >
                        this.world.terrainHeight(this.pos.x, this.pos.z);
      if (overWater) {
        events.crash('You ditched into the sea!');
        return;
      }
      if (impact > CRASH_SPEED || this.vel.length() > CRASH_SPEED * 1.6) {
        events.crash('Hard impact — the helicopter is destroyed!');
        return;
      }
      if (impact > 8) {
        this.hull = Math.max(0, this.hull - (impact - 8) * 0.08);
        events.damage();
        if (this.hull <= 0) { events.crash('The airframe gave out!'); return; }
      }
      this.pos.y = minY;
      if (this.vel.y < 0) this.vel.y = 0;
      // skid friction on the ground
      this.vel.x *= 1 - Math.min(1, dt * 12);
      this.vel.z *= 1 - Math.min(1, dt * 12);
      this.landed = this.vel.length() < 1.5;
    } else {
      this.landed = false;
    }

    // building side collision (fuselage / rotor strike)
    const b = this.world.buildingAt(this.pos, 1.2);
    if (b && this.pos.y < b.max.y) {
      const spd = this.vel.length();
      if (spd > 6) {
        events.crash('Rotor strike on a building!');
        return;
      }
      // push out along the smallest penetration axis
      const dxl = this.pos.x - (b.min.x - 1.2), dxr = (b.max.x + 1.2) - this.pos.x;
      const dzl = this.pos.z - (b.min.z - 1.2), dzr = (b.max.z + 1.2) - this.pos.z;
      const m = Math.min(dxl, dxr, dzl, dzr);
      if (m === dxl) { this.pos.x = b.min.x - 1.2; this.vel.x = Math.min(0, this.vel.x); }
      else if (m === dxr) { this.pos.x = b.max.x + 1.2; this.vel.x = Math.max(0, this.vel.x); }
      else if (m === dzl) { this.pos.z = b.min.z - 1.2; this.vel.z = Math.min(0, this.vel.z); }
      else { this.pos.z = b.max.z + 1.2; this.vel.z = Math.max(0, this.vel.z); }
      this.hull = Math.max(0, this.hull - spd * 0.01);
      events.damage();
    }
  }

  _updateWinch(dt, input, events) {
    this.winchOut = input.winch;
    const tgt = this.winchOut ? this.ropeMax : 0;
    this.ropeLen += clamp(tgt - this.ropeLen, -dt * 14, dt * 9);

    const hp = this.hookPos;
    // clamp the hook to whatever surface is below it
    let floorY = this.world.terrainHeight(hp.x, hp.z);
    const b = this.world.buildingAt(new THREE.Vector3(hp.x, floorY + 0.5, hp.z));
    const roofB = this.world.buildingAt(new THREE.Vector3(hp.x, hp.y, hp.z));
    if (roofB) floorY = Math.max(floorY, roofB.max.y);
    const w = this.ocean.waveHeight(hp.x, hp.z);
    if (w > floorY) floorY = w;
    if (hp.y < floorY) { hp.y = floorY; this.ropeLen = this.pos.y - 1.3 - floorY; }

    this.hook.position.copy(hp);
    const ropePts = this.ropeLine.geometry.attributes.position;
    ropePts.setXYZ(0, this.pos.x, this.pos.y - 1.3, this.pos.z);
    ropePts.setXYZ(1, hp.x, hp.y, hp.z);
    ropePts.needsUpdate = true;
    this.ropeLine.visible = this.hook.visible = this.ropeLen > 0.4;

    // pick up a survivor
    if (this.winchOut && !this.hookLoad && this.ropeLen > 3 && this.aboard < this.capacity) {
      const s = events.survivors.nearestWaiting(hp, 3.2);
      if (s) {
        s.attachToHook();
        this.hookLoad = s;
        events.message('Survivor on the hook — reel them in!');
      }
    }
    // carry the hooked survivor
    if (this.hookLoad) {
      this.hookLoad.group.position.set(hp.x, hp.y - 1.9, hp.z);
      if (this.ropeLen < 1.2) {
        this.hookLoad.state = 'aboard';
        this.hookLoad.group.visible = false;
        this.aboard++;
        events.pickedUp(this.hookLoad);
        this.hookLoad = null;
      }
    }
  }

  explode(fireSystem) {
    this.crashed = true;
    this.mesh.visible = false;
    this._blob.visible = false;
    this.ropeLine.visible = this.hook.visible = false;
    const e = fireSystem.spawn(this.pos.clone(), { radius: 3, count: 90 });
    setTimeout(() => e.extinguish(), 2600);
  }
}
