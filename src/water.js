import * as THREE from '../vendor/three.module.js';

// Ocean: Gerstner waves displaced on the GPU (vertex shader), so the CPU
// pays nothing per-vertex. waveHeight(x, z) evaluates the SAME wave sum
// analytically at single points for physics/buoyancy, so rafts and the
// helicopter interact with exactly the surface that is rendered.
// flatShading derives normals from screen-space derivatives in the fragment
// shader, so displaced vertices light correctly with no normal recompute.

const WAVES = [
  // dirX, dirZ, amplitude, wavelength, speed
  [1.0, 0.15, 0.9, 46, 5.2],
  [0.7, 0.7, 0.55, 27, 4.0],
  [-0.2, 1.0, 0.32, 15, 3.1],
  [0.9, -0.5, 0.18, 8, 2.4],
];

// GLSL for the same wave sum (y displacement + Gerstner xz sharpening)
function waveGLSL() {
  let s = 'vec3 waveDisp(vec2 p){\n  vec3 d = vec3(0.0);\n  float k, ph, a;\n  vec2 dir;\n';
  for (const [dx, dz, amp, len, spd] of WAVES) {
    const il = 1 / Math.hypot(dx, dz);
    s += `  dir = vec2(${(dx * il).toFixed(5)}, ${(dz * il).toFixed(5)});\n`;
    s += `  k = ${((Math.PI * 2) / len).toFixed(6)};\n`;
    s += `  ph = dot(p, dir) * k + uTime * ${(spd * ((Math.PI * 2) / len)).toFixed(6)};\n`;
    s += `  a = ${amp} * uStorm;\n`;
    s += '  d.y += a * sin(ph);\n  d.xz += 0.35 * a * dir * cos(ph);\n';
  }
  s += '  return d;\n}\n';
  return s;
}

export class Ocean {
  constructor(scene, { level = 0, size = 900, segments = 96, shoreX = -145 } = {}) {
    this.level = level;
    this.time = 0;
    this.storm = 1; // multiplier raised by weather during rain
    this.shoreX = shoreX; // no water east of this line

    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);

    this.uTime = { value: 0 };
    this.uStorm = { value: 1 };
    const mat = new THREE.MeshPhongMaterial({
      color: 0x1a5f8a,
      emissive: 0x06283d,
      specular: 0x88bbdd,
      shininess: 60,
      flatShading: true,
      transparent: true,
      opacity: 0.92,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.uniforms.uStorm = this.uStorm;
      shader.vertexShader =
        'uniform float uTime;\nuniform float uStorm;\n' + waveGLSL() +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec2 wavePos = (modelMatrix * vec4(position, 1.0)).xz;
          transformed += waveDisp(wavePos);`
        );
    };
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
    this.uTime.value = this.time;
    this.uStorm.value = this.storm;
  }
}
