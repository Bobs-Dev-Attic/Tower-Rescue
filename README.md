# Tower Rescue 🚁

A mobile-friendly, low-poly **isometric helicopter rescue simulator** that runs in any modern browser. Skyscrapers burn and collapse, hikers are stranded on snowy peaks and sailors drift on a stormy sea — you fly the rescue helicopter.

## Play

No build step. Serve the folder with any static server and open it on your phone or desktop:

```bash
# any of these:
npx serve .
python3 -m http.server 8080
```

Then open `http://localhost:8080` (or your machine's LAN IP on your phone).

## Controls

| Input | Touch | Keyboard |
|---|---|---|
| Move (cyclic) | Left stick | `W A S D` |
| Climb / descend (collective) | Right stick ↑↓ | `R` / `F` |
| Turn (yaw) | Right stick ←→ | `Q` / `E` |
| Winch | WINCH button | `Space` |

Hover over a survivor, lower the **winch**, reel them in, then land on the red **H** hospital pad to deliver them (+100 each). Land on the yellow **B** base pad to refuel and repair.

## Simulation features

- **Flight physics** — rotor thrust along the tilted rotor axis, attitude inertia, quadratic drag, ground effect, rotor spool-up, fuel burn, hull damage and hard-impact crashes.
- **Weather** — a wandering wind field with altitude boost and gusts, rain fronts that roll in and out, thermal **updrafts above fires**, orographic lift on windward mountain slopes, and storm downdrafts.
- **Fire** — pooled particle fire + smoke with flickering point lights; fire spreads through building floors, is damped by rain, and feeds the thermal updraft field.
- **Collapsing buildings** — burning towers lose structural integrity, shake, then collapse into tumbling debris with bounce physics and a dust cloud. Anyone still on the roof is lost.
- **Ocean** — a sum-of-Gerstner-waves surface displaced on the CPU; the *same* analytic wave function drives rendering, raft buoyancy/tilt and helicopter ditching, and storms raise the sea state.
- **Low-poly world** — procedural heightfield terrain (beach, grass, rock, snow), a flat-shaded city, trees, all generated from a seeded RNG so the map is stable.
- **Audio** — fully procedural rotor whomp + engine hum via WebAudio (no assets).

## Versioning

The game version lives in [`src/version.js`](src/version.js) (semver) and is displayed in the top-right corner of the game and on the start screen. Bump it with every merged change: **patch** for fixes/tuning, **minor** for new features, **major** for breaking overhauls.

## Tech

Plain ES modules + [Three.js](https://threejs.org) (vendored in `vendor/`). No bundler, no dependencies to install.

```
index.html        shell, HUD, touch controls, start screen
src/main.js       scene, isometric camera, game loop, scoring
src/heli.js       flight model, collisions, winch
src/world.js      terrain, city, collapse & debris physics, helipads
src/water.js      Gerstner-wave ocean + buoyancy sampling
src/weather.js    wind / gusts / rain / updraft field
src/fire.js       particle fire & smoke system
src/survivors.js  rescue targets & their habitats
src/controls.js   dual virtual joysticks + keyboard
src/hud.js        gauges & messages
src/audio.js      procedural rotor sound
src/version.js    game version (semver, shown on screen)
```
