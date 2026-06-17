# Game Improvement Task List

This list turns the next phase of the project into concrete implementation jobs. Keep jobs small enough to finish and verify independently.

## Milestone 1: Tuning And Debug Foundation

### [x] Add In-Game Debug Overlay

**Goal:** Make vehicle, AI, and terrain behavior visible while driving.

**Jobs:**

- Add a debug overlay toggle, preferably a single keyboard key.
- Show player vehicle speed, forward speed, yaw, steering input, throttle, brake, and handbrake.
- For each AI racer, show current checkpoint, distance to checkpoint, speed, target speed if exposed, stuck timer, progress timer, current surface, grounded wheel count, and sliding wheel count.
- Show race phase, elapsed time, player position, and current checkpoint index.
- Keep the overlay readable without blocking the center driving view.

**Acceptance Criteria:**

- Overlay can be toggled on/off during play.
- Values update live.
- No TypeScript or lint errors.
- Debug code is isolated enough that it can be disabled or hidden for release.

**Priority:** High  
**Depends On:** None

### [x] Add AI Telemetry Fields

**Goal:** Expose important internal AI driver decisions for debugging.

**Jobs:**

- Add a readonly telemetry object to `AiDriver`.
- Track target speed, bearing error, surface multiplier, slide ratio, upright value, tumble rate, stuck timer, progress timer, and unstick timer.
- Populate telemetry every `drive()` call.
- Reset telemetry when the driver resets.

**Acceptance Criteria:**

- Debug overlay can read AI state without duplicating AI calculations.
- AI behavior does not change from telemetry alone.
- Telemetry values are safe defaults before the first drive tick.

**Priority:** High  
**Depends On:** Add In-Game Debug Overlay

### [x] Create Automated AI Race Test

**Goal:** Stop tuning AI by feel alone.

**Jobs:**

- Add a script that runs the simulation without rendering.
- Simulate a full race for all AI racers from a fresh start.
- Report finish times, checkpoint progress, stuck events, rollovers or kill-height resets, and average speed.
- Fail or warn if any AI does not finish within a fixed time limit.
- Add an npm script such as `npm run test:ai`.

**Acceptance Criteria:**

- Script runs from the command line.
- Script is deterministic with the current world seed.
- Output is concise enough to compare between tuning changes.

**Priority:** High  
**Depends On:** AI Telemetry Fields

## Milestone 2: Smarter AI

### [x] Add Speed-Based Lookahead

**Goal:** Prevent AI from aiming too close at high speed or too far while crawling.

**Jobs:**

- Replace fixed AI lookahead with dynamic lookahead based on forward speed.
- Use shorter lookahead for tight turns, poor surfaces, or unstable chassis attitude.
- Keep the current checkpoint capture behavior unchanged.
- Tune per-skill variation so stronger AI carries more speed without missing gates.

**Acceptance Criteria:**

- AI takes smoother lines on fast sections.
- AI no longer overshoots as often near checkpoints.
- AI race test shows equal or better finish consistency.

**Priority:** High  
**Depends On:** Automated AI Race Test

### [x] Add Terrain-Aware Aim Offset

**Goal:** Let AI avoid obviously bad terrain when a small detour is available.

**Jobs:**

- Sample terrain surface and height along a few candidate aim directions.
- Penalize water, mud, snow, steep slopes, and obstacle-dense routes.
- Pick a modest lateral aim offset rather than a full pathfinder.
- Smooth aim offset over time to avoid twitchy steering.

**Acceptance Criteria:**

- AI visibly avoids the worst mud/water when nearby dry ground exists.
- AI still drives directly when detours would be worse.
- Candidate sampling cost does not hurt frame rate.

**Priority:** High  
**Depends On:** Speed-Based Lookahead

### [x] Add AI Recovery States

**Goal:** Make AI recover from bad terrain, obstacles, rollovers, and repeated failed moves.

**Jobs:**

- Replace simple unstick timer with named states: normal, reverse, pause, crawl, and reset-if-hopeless.
- Track repeated stuck attempts at the same checkpoint.
- After reversing, briefly crawl forward instead of immediately flooring it.
- If nearly upside down for too long, trigger a reset or controlled recovery behavior.

**Acceptance Criteria:**

- AI does not loop forever against the same obstacle.
- AI can recover from mud or steep terrain without repeated full-throttle digging.
- Recovery state is visible in the debug overlay.

**Priority:** Medium  
**Depends On:** AI Telemetry Fields

### [x] Add AI Driver Personalities

**Goal:** Make opponents feel distinct.

**Jobs:**

- Add AI profile fields for aggression, terrain caution, recovery patience, brake bias, and preferred speed.
- Give each existing opponent a different profile.
- Tune names/colors/profile combinations so behavior is readable in races.

**Acceptance Criteria:**

- One AI feels fast and risky.
- One AI feels stable and consistent.
- One AI handles rough terrain better but has lower top pace.

**Priority:** Medium  
**Depends On:** Recovery States

## Milestone 3: Visual Richness

### [x] Add Wheel Surface Particles

**Goal:** Give immediate visual feedback for terrain and speed.

**Jobs:**

- Add lightweight particles emitted from grounded wheels.
- Use different colors and behavior for dust, mud spray, snow powder, sand, and water spray.
- Scale emission by speed, wheel slip, and surface type.
- Cap particle count and reuse objects to avoid garbage collection spikes.

**Acceptance Criteria:**

- Particles appear only when appropriate.
- Mud/water/snow are visually distinct.
- Frame rate remains stable during four-car races.

**Priority:** High  
**Depends On:** None

### [x] Add Tire Tracks Or Temporary Ground Marks

**Goal:** Make driving leave visible traces.

**Jobs:**

- Prototype short-lived decals or simple strip geometry behind wheels.
- Vary color/opacity by surface.
- Fade tracks over time or by distance from camera.
- Avoid expensive per-frame terrain modification.

**Acceptance Criteria:**

- Tracks are visible on grass, mud, sand, and snow.
- Tracks do not accumulate without limit.
- No major z-fighting or flicker.

**Priority:** Medium  
**Depends On:** Wheel Surface Particles

### [x] Improve Checkpoint Presentation

**Goal:** Make gates easier to read and more exciting to pass through.

**Jobs:**

- Replace or enhance current checkpoint visuals with flags, animated rings, banners, or smoke flares.
- Make the active checkpoint visually dominant.
- Add pass feedback: flash, sound hook, particle burst, or animation.
- Ensure far checkpoints are visible without cluttering the horizon.

**Acceptance Criteria:**

- Player can identify the next checkpoint quickly.
- Passing a checkpoint has clear feedback.
- Visuals still fit the low-poly/off-road style.

**Priority:** High  
**Depends On:** None

### [x] Upgrade Vehicle Visual Details

**Goal:** Make cars feel less like plain placeholders.

**Jobs:**

- Add brake lights driven by brake input.
- Add simple exhaust or dust wake hook.
- Add small model details: roll cage, spare tire, mirrors, number plates, or colored trim.
- Rework the underside so the car does not look like a flat floating plate when airborne.
- Add visible chassis depth: lower frame rails, skid plate, differential/axle hints, suspension arms, and wheel well shadow geometry.
- Shape the bottom plate with bevels or stepped geometry so side and rear views show thickness.
- Add optional per-opponent visual variations.

**Acceptance Criteria:**

- Brake lights respond in real time.
- Opponent cars are distinguishable beyond color alone.
- From low chase camera and jump angles, the car reads as a 3D chassis rather than a flat slab.
- Underside geometry does not clip through wheels or suspension travel in normal driving.
- Additional geometry does not noticeably hurt performance.

**Priority:** Medium  
**Depends On:** None

### [x] Improve Vehicle Undercarriage Silhouette

**Goal:** Fix the current flat bottom plate so jumps, rollovers, and chase-camera views look believable.

**Jobs:**

- Audit [src/render/jeepModel.ts](/Users/lszabadkai/terep4/src/render/jeepModel.ts) and identify which meshes form the visible bottom silhouette.
- Add a darker recessed underbody layer below the main body.
- Add simple low-poly frame rails running front-to-back.
- Add front and rear axle/differential blocks or crossbars so the wheel area has mechanical depth.
- Add wheel arch or inner fender shadow pieces where the body currently reads as a flat rectangle.
- Use restrained geometry and the existing low-poly style; avoid over-detailed mechanical modeling.

**Acceptance Criteria:**

- When the car is airborne, upside down, or cresting a hill, the underside has visible structure and depth.
- The visual mass of the car sits lower and feels connected to the wheels.
- Existing body color customization for opponents still works.
- No new geometry causes obvious z-fighting, clipping, or excessive draw calls.

**Priority:** High  
**Depends On:** None

### [x] Improve Water And Shorelines

**Goal:** Make water areas feel intentional rather than flat hazards.

**Jobs:**

- Animate water material subtly.
- Add reeds, rocks, or foam-like shoreline details.
- Improve water color and transparency where terrain is shallow.
- Add stronger wheel spray when crossing water.

**Acceptance Criteria:**

- Water is easier to identify at speed.
- Shoreline areas look more varied.
- Water hazards feel fair because players can read them early.

**Priority:** Medium  
**Depends On:** Wheel Surface Particles

## Milestone 4: World Variety

### [x] Add Biome Regions

**Goal:** Make the procedural world feel less uniform.

**Jobs:**

- Define a typed biome catalog: open grassland, pine forest, marsh, rocky highlands, snow ridge, sandy shore, and river valley.
- Add a `Terrain.biome(x, z)` sampler that is deterministic from the existing world seed.
- Drive biome choice from altitude, slope, water proximity, distance from spawn, and large-scale noise.
- Blend biome borders so transitions feel natural instead of hard checkerboard regions.
- Use biome data to influence scatter density, surface patches, and prop choices.
- Expose biome name in the debug overlay once the sampler exists.
- Keep spawn area friendly and readable.

**Acceptance Criteria:**

- Driving between checkpoints crosses visibly different regions.
- Biome transitions are smooth.
- Existing terrain generation remains deterministic.
- Spawn remains mostly open grassland with clear sightlines.

**Priority:** High  
**Depends On:** None

### [x] Add Geographic Location Zones

**Goal:** Give the map memorable places, not only material changes.

**Jobs:**

- Generate named geographic zones from the world seed, such as North Ridge, Blackpine Woods, Low Marsh, Redstone Flats, Snowcap Pass, and South Shore.
- Assign each zone a center, radius, biome preference, landmark style, and scatter style.
- Make checkpoint generation prefer crossing or approaching different zones so races have variety.
- Add lightweight location discovery UI: show the current location name briefly when entering a new zone.
- Add location info to the debug overlay for tuning.

**Acceptance Criteria:**

- The player can recognize and name places after a few races.
- Location boundaries are deterministic and stable across reloads.
- Checkpoint routes do not stay entirely inside one zone.
- Location UI does not clutter the driving view.

**Priority:** High  
**Depends On:** Biome Regions

### [x] Add Biome-Specific Terrain Color Palettes

**Goal:** Make each biome visually readable from the driving camera.

**Jobs:**

- Add color tint rules per biome for grass, rock, mud, sand, snow, and water-bed surfaces.
- Make marshes darker/greener, highlands grayer, forests deeper green, shores warmer, and snow ridges colder/brighter.
- Keep surface identity readable: mud must still look like mud, snow like snow, water like water.
- Tune fog/sky only if needed, without making the whole game one-note.

**Acceptance Criteria:**

- Biomes are visible before props load in.
- Surface colors remain readable for gameplay.
- Palette variety improves without breaking the existing low-poly style.

**Priority:** High  
**Depends On:** Biome Regions

### [x] Add Biome-Specific Prop Rules

**Goal:** Make scatter support geographic identity instead of being generic trees everywhere.

**Jobs:**

- Pine forest: dense pines, fallen logs, dead trees, fewer boulders.
- Marsh: reeds, small bushes, wet logs, sparse trees, more mud/water-edge detail.
- Rocky highlands: boulders, stone clusters, sparse shrubs, fewer tall trees.
- Snow ridge: snow-tinted rocks, dead pines, sparse grass, fewer lowland props.
- Sandy shore: reeds, driftwood/logs, small stones, sparse bushes.
- Grassland: bushes, grass clumps, marker posts, occasional lone trees.
- Keep collision only on props that should matter to driving.

**Acceptance Criteria:**

- Each biome has a distinct prop mix.
- Props do not block checkpoints, spawn, or obvious racing lines unfairly.
- Scatter remains instanced or otherwise cheap enough for four-car races.

**Priority:** High  
**Depends On:** Biome Regions, Add More Scatter Props

### [x] Add More Scatter Props

**Goal:** Increase environmental variety without changing core terrain.

**Jobs:**

- Add bushes, small rocks, logs, reeds, dead trees, grass clumps, and marker posts.
- Use instancing where possible.
- Give each prop collision only when it matters.
- Add clear placement rules so roads/checkpoints are not blocked unfairly.

**Acceptance Criteria:**

- World looks richer from the driving camera.
- Props do not make the race unreadable.
- No obvious prop overlap around checkpoints or spawn.

**Priority:** High  
**Depends On:** Biome Regions

### [x] Add Landmarks Near Checkpoints

**Goal:** Make course locations memorable.

**Jobs:**

- Add one landmark candidate per checkpoint area.
- Examples: watchtower, cabin, radio mast, wrecked car, banner poles, stone arch, floodlight rig.
- Place landmarks outside the capture radius and away from direct racing lines.
- Use simple low-poly geometry or generated static meshes.

**Acceptance Criteria:**

- Each checkpoint area has a recognizable visual identity.
- Landmarks help navigation rather than blocking it.
- Placement is deterministic from the world seed.

**Priority:** Medium  
**Depends On:** More Scatter Props

### [x] Add Location-Specific Landmarks

**Goal:** Tie landmarks to geographic zones instead of placing generic decorations.

**Jobs:**

- Give each location type a small landmark set.
- Examples: watchtower in pine forest, radio mast on highland ridge, wrecked car in marsh, stone arch in rocky flats, cabin near shore, signal flags on snow pass.
- Place major landmarks near zone centers and minor landmarks near checkpoint approaches.
- Keep landmark collision simple and readable.

**Acceptance Criteria:**

- Landmarks reinforce the biome/location they belong to.
- Players can use landmarks for navigation.
- Landmarks are deterministic and do not overlap badly with terrain or checkpoints.

**Priority:** Medium  
**Depends On:** Geographic Location Zones, Landmarks Near Checkpoints

## Milestone 5: Race Flow And UX

### [x] Add Countdown Start

**Goal:** Make race starts feel deliberate and fair.

**Jobs:**

- Add a ready/countdown/running transition.
- Lock AI and player throttle until countdown finishes.
- Show countdown UI.
- Start race clock only after countdown completes.

**Acceptance Criteria:**

- Player and AI start together.
- Restart race returns to countdown.
- Existing ready/running/finished logic remains understandable.

**Priority:** High  
**Depends On:** None

### [x] Add Finish Results Screen

**Goal:** Give closure and useful feedback after a race.

**Jobs:**

- Show final standings, finish times, player position, and restart prompt.
- Include checkpoint count and elapsed time.
- Keep the player able to restart quickly.

**Acceptance Criteria:**

- Results appear when the race finishes.
- Restart works from the results state.
- Standings match the existing race state.

**Priority:** High  
**Depends On:** None

### [x] Add Navigation Aid

**Goal:** Reduce confusion about where to drive next.

**Jobs:**

- Add a checkpoint direction arrow, compass marker, or minimap/radar.
- Show distance to the active checkpoint.
- Make the aid unobtrusive but readable while driving fast.

**Acceptance Criteria:**

- Player can find the next checkpoint without scanning the whole horizon.
- UI does not overlap important HUD elements.
- Aid works across all camera angles.

**Priority:** Medium  
**Depends On:** Improved Checkpoint Presentation

### [ ] Add Course Presets

**Goal:** Give replay variety and difficulty options.

**Jobs:**

- Add selectable race lengths: short, standard, long.
- Add terrain difficulty presets that adjust checkpoint radius, ring radius, and terrain risk.
- Keep defaults close to the current race.

**Acceptance Criteria:**

- Player can start different race types.
- Presets produce noticeably different pacing.
- AI can finish each preset reliably.

**Priority:** Medium  
**Depends On:** Automated AI Race Test

## Milestone 6: Audio And Game Feel

### [x] Add Engine And Surface Audio Hooks

**Goal:** Make speed and terrain understandable through sound.

**Jobs:**

- Add engine pitch based on throttle and speed.
- Add engine load/strain variation so bogging in mud or climbing hills sounds different from coasting.
- Add surface loop or one-shot hooks for mud, water, gravel, and snow.
- Add collision impact sound hook.
- Add jump/landing audio hooks based on suspension compression or chassis impact.
- Keep audio toggle/mute setting available.

**Acceptance Criteria:**

- Audio responds to driving inputs and surfaces.
- Sounds do not stack uncontrollably.
- Game can still run muted.
- Audio starts only after user interaction so browser autoplay policies are respected.

**Priority:** Medium  
**Depends On:** None

### [x] Add Music System

**Goal:** Give races energy without overwhelming engine and terrain feedback.

**Jobs:**

- Add a lightweight music manager that starts after the player begins the race.
- Add at least two loopable music states: menu/ready and race.
- Support fade in, fade out, and crossfade between states.
- Add a separate music volume control or mute flag from sound effects.
- Keep music assets small enough for fast local loading.
- Prefer loop points or generated/simple layered music that does not click at loop boundaries.

**Acceptance Criteria:**

- Music starts reliably after the first player interaction.
- Menu/ready music and race music transition without hard cuts.
- Music can be muted independently from sound effects.
- Music never masks key gameplay sounds like checkpoint pass, collision, or engine strain.

**Priority:** Medium  
**Depends On:** Settings Persistence

### [x] Add Race Feedback Sounds

**Goal:** Make checkpoint and race-state events feel responsive.

**Jobs:**

- Add countdown beeps once countdown start exists.
- Add checkpoint pass sound with a stronger variation for the final checkpoint.
- Add finish sound for race completion.
- Add UI confirm/pause/restart sound hooks.
- Keep all event sounds short, readable, and non-annoying over repeated races.

**Acceptance Criteria:**

- Important race events are understandable without looking away from the road.
- Sounds trigger once per event and do not double-play during frame updates.
- Event sounds respect the sound effects mute/volume setting.

**Priority:** Medium  
**Depends On:** Countdown Start, Improved Checkpoint Presentation

### [x] Add Audio Settings UI

**Goal:** Let players control sound and music cleanly.

**Jobs:**

- Add sound effects volume, music volume, mute all, and possibly engine volume controls.
- Persist audio settings in local storage.
- Validate saved values before applying them.
- Make settings reachable from pause or start UI without cluttering the driving HUD.

**Acceptance Criteria:**

- Settings survive page reloads.
- Muting takes effect immediately.
- Bad stored values fall back to defaults.
- Keyboard driving controls are not blocked by audio settings UI.

**Priority:** Medium  
**Depends On:** Settings Persistence

### [ ] Add Camera Impact And Speed Polish

**Goal:** Make motion feel faster without harming control.

**Jobs:**

- Add subtle camera shake for hard landings and collisions.
- Add speed-based FOV or camera distance adjustment.
- Add damping so the camera does not become nauseating on rough terrain.

**Acceptance Criteria:**

- High speed feels more intense.
- Rough terrain feedback is noticeable but controlled.
- Camera never clips through terrain more than it does now.

**Priority:** Medium  
**Depends On:** None

## Milestone 7: Technical Cleanup

### [ ] Split AI Config Into Profiles

**Goal:** Avoid one giant shared AI tuning block.

**Jobs:**

- Keep shared AI constants in `AI`.
- Add per-opponent AI profile config.
- Move personality values out of hard-coded calculations.
- Document what each profile field changes.

**Acceptance Criteria:**

- Opponent tuning can be changed without editing AI logic.
- Defaults preserve current behavior as closely as possible.
- TypeScript catches missing profile fields.

**Priority:** Medium  
**Depends On:** AI Driver Personalities

### [ ] Add Performance Counters

**Goal:** Track frame/render cost while adding visual richness.

**Jobs:**

- Show FPS, active chunks, scatter instances, particle count, and draw-call estimate if available.
- Add this to the debug overlay.
- Use it while tuning particles and scatter.

**Acceptance Criteria:**

- Debug overlay exposes useful performance numbers.
- Visual additions have measurable budgets.

**Priority:** Medium  
**Depends On:** Debug Overlay

### [ ] Add Settings Persistence

**Goal:** Let players keep preferred options.

**Jobs:**

- Add local storage for graphics quality, audio mute, camera distance, and difficulty.
- Validate stored values before applying them.
- Provide reasonable defaults.

**Acceptance Criteria:**

- Settings survive page refresh.
- Bad stored values do not break the game.
- Defaults work with no existing storage.

**Priority:** Low  
**Depends On:** Settings UI

## Suggested Implementation Order

1. Add AI telemetry fields.
2. Add in-game debug overlay.
3. Create automated AI race test.
4. Add speed-based AI lookahead.
5. Add terrain-aware AI aim offset.
6. Add AI recovery states.
7. Improve vehicle undercarriage silhouette.
8. Add checkpoint presentation upgrade.
9. Add wheel surface particles.
10. Add engine and surface audio hooks.
11. Add countdown and finish results screen.
12. Add race feedback sounds.
13. Add biome regions.
14. Add more scatter props.
15. Add music system.
16. Add audio settings UI.

## Definition Of Done For Each Job

- Code is scoped to the job.
- `npm run typecheck` passes.
- `npm run lint` passes.
- `npm run build` passes for rendering or app-level changes.
- Visual changes are checked in the browser at desktop and narrow viewport sizes.
- AI changes are checked with the automated AI race test once it exists.
