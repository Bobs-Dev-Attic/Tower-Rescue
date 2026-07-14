import * as THREE from '../vendor/three.module.js';
import { Controls } from './controls.js';
import { FireSystem } from './fire.js';
import { World } from './world.js';
import { Ocean } from './water.js';
import { Weather } from './weather.js';
import { SurvivorManager } from './survivors.js';
import { Helicopter } from './heli.js';
import { HUD } from './hud.js';
import { RotorAudio } from './audio.js';
import { clamp } from './util.js';
import { VERSION } from './version.js';
import { initSettingsPanel } from './settingsPanel.js';

initSettingsPanel();

document.getElementById('version').textContent = 'v' + VERSION;
document.getElementById('startVersion').textContent = 'v' + VERSION;

// ---------- renderer / scene ----------
// MSAA only on low-DPI screens: high-DPI phones are already supersampled
// by the pixel ratio and the extra fill-rate cost isn't worth it.
const renderer = new THREE.WebGLRenderer({
  antialias: window.devicePixelRatio <= 1,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9db8d9);
scene.fog = new THREE.Fog(0x9db8d9, 320, 750);

// isometric camera: orthographic, fixed 4-directional yaw steps could be added;
// we use the classic 45°/35° iso angle and follow the helicopter.
const ISO_YAW = Math.PI / 4;
const aspect = window.innerWidth / window.innerHeight;
let viewSize = 60;
const camera = new THREE.OrthographicCamera(-viewSize * aspect, viewSize * aspect, viewSize, -viewSize, -400, 900);
function placeCamera(target) {
  const d = 220;
  camera.position.set(
    target.x + Math.cos(ISO_YAW) * d,
    target.y + d * 0.72,
    target.z + Math.sin(ISO_YAW) * d
  );
  camera.lookAt(target);
}

const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
sun.position.set(120, 180, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -120; sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120;
sun.shadow.camera.far = 600;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xbdd7f2, 0x3a4a3a, 0.9));

// ---------- systems ----------
const fires = new FireSystem(scene);
const world = new World(scene, fires);
const ocean = new Ocean(scene, { level: 0, size: 800, segments: 80, shoreX: -145 });
ocean.mesh.position.x = -545; // ocean strictly west of the beach
const weather = new Weather(scene, { terrainHeight: world.terrainHeight, fireSystem: fires });
const survivors = new SurvivorManager(scene, world, ocean);
const heli = new Helicopter(scene, world, ocean, weather);
const controls = new Controls();
const hud = new HUD();
const audio = new RotorAudio();

let rescued = 0;
let running = false;

// initial disasters so the world is alive from the first second
survivors.spawnRoof();
survivors.spawnRoof();
survivors.spawnMountain();
survivors.spawnSea();

world.onCollapse = () => hud.message('A tower has collapsed!', 3);
survivors.onEvent = (type, s) => {
  if (type === 'spawn') {
    const where = { roof: 'a burning tower', mountain: 'the mountains', sea: 'the open sea' }[s.kind];
    hud.message(`Mayday — someone is stranded on ${where}!`, 3.5);
  } else if (type === 'lost') {
    hud.message('A survivor was lost…', 3);
  }
};

const events = {
  survivors,
  message: (t) => hud.message(t),
  pickedUp: (s) => {
    hud.message(`Survivor aboard (${heli.aboard}/${heli.capacity}) — fly them to the H pad`);
    if (s.building) s.building.hasSurvivor = false;
    s.rescueComplete(scene);
  },
  damage: () => {},
  crash: (why) => {
    heli.explode(fires);
    survivors.lost += heli.aboard;
    hud.message(why + ' Respawning at base…', 4);
    setTimeout(() => heli.resetAtBase(), 3200);
  },
};

function handlePads(dt) {
  if (!heli.landed || heli.crashed) return;
  const onPad = (pad) => Math.hypot(heli.pos.x - pad.x, heli.pos.z - pad.z) < pad.r;
  if (onPad(world.basePad)) {
    const before = heli.fuel < 0.995 || heli.hull < 0.995;
    heli.fuel = Math.min(1, heli.fuel + dt * 0.12);
    heli.hull = Math.min(1, heli.hull + dt * 0.08);
    if (before && heli.fuel >= 0.995 && heli.hull >= 0.995) hud.message('Refueled & repaired');
  }
  if (onPad(world.hospitalPad) && heli.aboard > 0) {
    rescued += heli.aboard;
    hud.message(`${heli.aboard} survivor${heli.aboard > 1 ? 's' : ''} delivered to hospital! +${heli.aboard * 100}`);
    heli.aboard = 0;
  }
}

// out-of-fuel autorotation warning
let fuelWarned = false;

// ---------- adaptive quality ----------
// Watch the real frame rate and step down through tiers until it holds:
//   0: full DPR + shadow maps   1: DPR 1.5 + shadows
//   2: DPR 1.25, shadows -> blob shadow   3: DPR 1
const quality = { tier: 0, acc: 0, frames: 0, warmup: 3 };
const TIER_DPR = [Math.min(window.devicePixelRatio, 2), 1.5, 1.25, 1];

function applyTier(t) {
  quality.tier = t;
  renderer.setPixelRatio(TIER_DPR[t]);
  renderer.setSize(window.innerWidth, window.innerHeight);
  const shadows = t < 2;
  if (renderer.shadowMap.enabled !== shadows) {
    renderer.shadowMap.enabled = shadows;
    sun.castShadow = shadows;
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    heli.setBlobShadow(!shadows);
  }
}

function watchPerformance(dt) {
  if (quality.warmup > 0) { quality.warmup -= dt; return; } // skip shader warmup
  quality.acc += dt;
  quality.frames++;
  if (quality.acc >= 3) {                                    // evaluate every 3 s
    const avg = quality.acc / quality.frames;
    if (avg > 0.022 && quality.tier < TIER_DPR.length - 1) { // sustained < ~45 fps
      applyTier(quality.tier + 1);
      quality.warmup = 2;                                    // settle before re-judging
    }
    quality.acc = 0;
    quality.frames = 0;
  }
}

// ---------- resize ----------
window.addEventListener('resize', () => {
  const a = window.innerWidth / window.innerHeight;
  camera.left = -viewSize * a; camera.right = viewSize * a;
  camera.top = viewSize; camera.bottom = -viewSize;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- start ----------
document.getElementById('btnStart').addEventListener('click', () => {
  document.getElementById('start').style.display = 'none';
  audio.start();
  running = true;
});

// ---------- main loop ----------
const camTarget = new THREE.Vector3().copy(heli.pos);
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!running) { renderer.render(scene, camera); return; }

  controls.update();
  heli.update(dt, controls, events);
  world.update(dt);
  ocean.update(dt);
  weather.update(dt, camTarget, ocean);
  fires.update(dt, weather.wind, weather.rain, camTarget);
  survivors.update(dt);
  handlePads(dt);
  watchPerformance(dt);

  if (heli.fuel <= 0 && !fuelWarned) {
    fuelWarned = true;
    hud.message('OUT OF FUEL — autorotating!', 4);
  }
  if (heli.fuel > 0) fuelWarned = false;

  // smooth camera follow + gentle zoom out with speed
  camTarget.lerp(heli.pos, 1 - Math.pow(0.02, dt));
  const wantView = clamp(52 + heli.vel.length() * 0.9 + heli.pos.y * 0.12, 52, 90);
  if (Math.abs(wantView - viewSize) > 0.3) {
    viewSize += (wantView - viewSize) * dt * 1.5;
    const a = window.innerWidth / window.innerHeight;
    camera.left = -viewSize * a; camera.right = viewSize * a;
    camera.top = viewSize; camera.bottom = -viewSize;
    camera.updateProjectionMatrix();
  }
  placeCamera(camTarget);
  sun.position.set(camTarget.x + 120, camTarget.y + 180, camTarget.z + 60);
  sun.target.position.copy(camTarget);

  // sky darkens with rain
  const sky = new THREE.Color(0x9db8d9).lerp(new THREE.Color(0x4a5a6e), weather.rain);
  scene.background.copy(sky);
  scene.fog.color.copy(sky);
  sun.intensity = 2.4 - weather.rain * 1.3;

  audio.update(heli.rotorSpeed, Math.abs(controls.collective));
  hud.update(dt, { heli, weather, rescued, lost: survivors.lost, camYaw: ISO_YAW });

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// debug/testing handle (harmless in production)
window.__game = { heli, world, ocean, weather, survivors, fires, quality, applyTier,
  get rescued() { return rescued; } };
