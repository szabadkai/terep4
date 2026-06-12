# Terep4

A Terep2-inspired off-road driving game: low-poly 3D, physically-modelled
suspension, surface-dependent handling, and a large drive-anywhere procedural
terrain. No walls, no track — point the buggy at a mountain and go.

## Running

```sh
npm install
npm run dev        # dev server at http://localhost:5173
```

| Script              | What it does                  |
| ------------------- | ----------------------------- |
| `npm run dev`       | Vite dev server with HMR      |
| `npm run build`     | Production build into `dist/` |
| `npm run preview`   | Serve the production build    |
| `npm run typecheck` | `tsc --noEmit` (strict mode)  |
| `npm run lint`      | ESLint                        |
| `npm run format`    | Prettier (writes)             |

**Controls:** `W`/`S` throttle & brake (brake reverses when stopped),
`A`/`D` steer, `Space` handbrake, `R` reset upright.

## Architecture

Three layers, each behind its own interface, wired together only in
`src/main.ts`:

```
input  →  simulation (fixed 60 Hz)  →  render (interpolated)
```

- **`src/input/`** — `InputState` is a plain data object the sim reads;
  `KeyboardInput` is just one producer of it (a gamepad or replay could be
  another).
- **`src/sim/`** — pure TypeScript physics, no Three.js imports. A custom
  rigid body (`rigidbody.ts`) carries the chassis; each `Wheel` casts a ray
  into the terrain and applies spring-damper suspension plus a
  friction-circle tire model at the contact point (`wheel.ts`). `Vehicle`
  owns drivetrain/steering logic and chassis-corner penalty contacts for
  crashes and rollovers. `SimWorld` steps everything at a fixed `1/60 s` and
  publishes plain-data `VehicleSnapshot`s (prev + curr).
- **`src/terrain/`** — continuous height/normal/surface sampling from
  deterministic value noise, plus a heightfield raycast. The `HeightSource`
  interface is the seam for swapping in image heightmaps. Surfaces
  (grass/rock/mud/snow/water) modulate tire friction, rolling resistance and
  drag — water slows you down hard but never kills you.
- **`src/render/`** — Three.js only here. Terrain is rendered as streamed
  chunks built around the vehicle and disposed when far away
  (`terrainView.ts`) — the physics never depends on what's loaded, so the
  map is effectively unbounded. `VehicleView` interpolates between the two
  sim snapshots for smooth visuals at any refresh rate; the chase camera and
  HUD read the same data.
- **`src/config.ts`** — every tuning constant in the game: vehicle masses,
  spring rates, tire response, surface friction table, terrain generation
  parameters, camera and palette. No magic numbers in logic code.

The render loop never mutates sim state; the sim never imports Three.js.

## Deployment

Pushes to `main` run typecheck → lint → build and deploy `dist/` to GitHub
Pages via `.github/workflows/deploy.yml`. In the repo settings, set
**Pages → Source** to **GitHub Actions** once.
