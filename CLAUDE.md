# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## This is NOT the Next.js / React you know

This repo runs **Next.js 16 (Turbopack) + React 19** — recent enough that APIs, conventions, and file structure may differ from training data. Before writing Next-specific code (route segment config, caching/`revalidate`, server vs client component rules, `app/` conventions), read the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices rather than assuming older-Next behavior.

## What this is

`cv-orman` is a standalone Next.js page (deployed to a subdomain of mertsoylu.dev) that renders the owner's own GitHub repos as trees on a floating voxel island. Tree size comes from stars/commits/age, tree color/wilt comes from days-since-last-push, tree species comes from primary language. It's a single-user, single-page app — no auth, no multi-tenancy, no database.

## Commands

```bash
npm run dev      # Turbopack dev server, http://localhost:3000
npm run build    # production build (also runs the TypeScript check)
npm run start    # serve the production build
npm run lint     # eslint (flat config: eslint-config-next core-web-vitals + typescript)
npx tsc --noEmit # typecheck only, faster than a full build
```

There is no test runner configured in this repo. Verification is tsc + lint + build, plus manually checking `/` in a browser (this is a visual/3D app — type-checking does not catch rendering or hydration bugs; see *Verifying visual changes* below).

Required env vars (see `.env.example`): `GITHUB_TOKEN` (a GitHub PAT with `public_repo` scope — despite the `.env.example` comment, a fine-grained `github_pat_...` token has been confirmed to work fine against the GraphQL endpoint, not just classic tokens) and `GITHUB_USERNAME`. Without both, `/` and `/api/repos` return a 502 with an explanatory message instead of failing silently.

`FOREST_MOCK=<count> npm run dev` swaps the GitHub fetch for `<count>` deterministic fake repos (`lib/github/mock.ts`). The scene is a visual product and cannot be judged from an error card, so working on it does not need a token. Try 3, 18 and 64 — the island sizes itself from the repo count and all three have to look right.

## Architecture

### Data pipeline (no database, stateless)

Growth/health are recomputed from live GitHub data on every fetch, cached only via Next's ISR (`revalidate`) — there is deliberately no DB, because GitHub's API already exposes everything needed to derive current state.

```
lib/github/query.ts        GraphQL query string (single query, paginated via `after`)
  -> lib/github/client.ts  fetchAllRepoNodes(): pages through all repos, throws GitHubFetchError
  -> lib/github/normalize.ts  normalizeRepoNodes(): drops archived repos (no GraphQL arg for that —
                               isFork is filtered server-side, isArchived must be filtered here),
                               delegates scoring to lib/forest/growth.ts (computeGrowthScore),
                               lib/forest/health.ts (computeHealthStage), and lib/forest/species.ts
                               (mapLanguageToSpecies, a plain language->species lookup table)
  -> lib/forest/path.ts    the spiral walk and the stream that crosses it, as pure math (no three.js)
  -> lib/forest/layout.ts  computeForestLayout(): walks that spiral -> integer {x, y} per tree id
  -> PlacedTreeData[]      passed straight into the renderer
```

`src/lib/forest/treeData.ts` (`TreeData` / `PlacedTreeData`) is the contract between the data layer and the renderer. Renderers only ever read the precomputed `growthScore` (0-1, drives scale) and `healthStage` (0-1, drives color/wilt) — never raw `stars`/`commitCount`/`lastPushedAt` directly. Keep that separation: it's what let the whole renderer be thrown away and rebuilt as voxels without touching the GitHub or scoring code.

`app/page.tsx` is a Server Component that calls `fetchAllRepoNodes` → `normalizeRepoNodes` → `computeForestLayout` **directly**, not by fetching its own `/api/repos` route, then hands the resulting `PlacedTreeData[]` (plus any fetch error) to `components/ForestPageClient.tsx` — a Client Component that owns the hero/legend overlay, stats, error/empty states, tree-selection state, and mounts `VoxelForest` + `TreeDetailPanel`. `/api/repos` still exists as a standalone JSON endpoint but is not on the real page's request path. Both `route.ts` and `page.tsx` declare `export const revalidate = 3600` as a hardcoded literal — Next.js requires route segment config to be statically analyzable, so it can't just import `REVALIDATE_SECONDS` from `lib/config.ts`; keep these three in sync by hand if you change the cache duration.

`ForestPageClient.tsx` also renders a visually-hidden (`.sr-only`) `RepoFallbackList` alongside the canvas — the 3D scene has no DOM equivalent, so this is the only path screen readers, crawlers, and no-JS/no-WebGL clients have to the repo data. `VoxelForest` is wrapped in an `ErrorBoundary` (class component; function components can't catch render errors) whose fallback re-renders `RepoFallbackList` visibly with a short explanatory heading — for when WebGL context creation itself throws. A `sceneReady` flag (flipped by `VoxelForest`'s `onReady` prop, fired after the engine's first complete frame) gates a `SceneLoadingIndicator` overlay so there's no blank gap between the route's `loading.tsx` (server fetch) and the scene's first WebGL frame (client init) — `loading.tsx` renders the same `SceneLoadingIndicator` component so the two waits read as one continuous state.

`lib/config.ts` centralizes the tunable weights: `GROWTH` (stars/commits/age weighting + soft caps), `HEALTH` (healthy/wilted day thresholds + wilted floor), `LAYOUT` (the spiral's start radius and loop gap, station spacing, tree setback, stream direction). **Every `LAYOUT` length is in voxels** — one voxel is one world unit and there is exactly one grid. `GITHUB_USERNAME`/`GITHUB_TOKEN` are read via lazy getters (`getGithubUsername()`/`getGithubToken()`), not top-level constants — `next build` imports route modules to collect segment config without ever calling the handlers, so an eager `requireEnv()` at module scope breaks the build whenever secrets aren't present at build time.

`lib/forest/path.ts` defines the exhibit walk as **pure math with no three.js dependency**, so it can run on the server: an Archimedean spiral parametrized by angle, plus the stream that runs radially out from the summit pond (`streamCoords`). Both the data layer and the renderer consume it — `computeForestLayout()` walks it to plant trees, the island generator walks the same curve to pave the path, hang lanterns and carve the water — so there is exactly one definition. `planSpiral()` steps stations *over* the stream: a station's two trees stand on the radial through it, which is the direction the stream runs, so a station at a crossing would plant both in the water.

`computeForestLayout()` places trees two per **station**, one inside the curve and one outside, **oldest repo first from the summit outward** — the walk is a timeline, entered at the gate among the newest repos. `createdAt` never changes, so nobody's place does either. Positions are rounded to whole voxels; a trunk straddling two cells cannot be drawn. There is no positional noise: the exhibit is planted on purpose, and the variation the eye needs comes from species and size.

### Renderer: `components/renderers/voxel/`

A **plain three.js engine with no react-three-fiber**. This is the only renderer; a smooth-shaded R3F arboretum preceded it and was deleted wholesale — don't resurrect it from git history without checking with the user first.

The scene is one floating voxel island: a spiral walk from a clay gate up to a summit pond, a stream running back down across the walk (plank bridges) and off the edge as a waterfall, a planter + sign + lantern per repo tree, a cabin wherever there is room, clouds and satellite rocks around it, crystals underneath. Everything is generated in code — **no model files, no textures, no fonts**.

**The one rule that makes it read as voxel art**: one voxel size, one grid, everywhere. Growth does not *scale* a tree, it *sizes* it (taller trunk, wider crown, more cubes). Nothing is rotated off-axis, nothing is smooth-shaded, the sun is a cube, particles are cubes, the sky is posterised, water sparkles in half-voxel pixels on a stepped clock, and labels use a 5x7 bitmap font. Anything smooth or off-grid immediately looks like it came from a different game.

- `VoxelForest.tsx` — React's entire involvement: one `<div>`, and `isDark`/`selectedId`/reduced-motion forwarded to the engine. Props are the contract with `ForestPageClient` (`trees`/`onSelect`/`selectedId`/`isDark`/`onReady`). A scene is a long-lived, imperatively-driven object graph, which is what React's model — and the React Compiler freezing memoised values — fights; the previous renderer needed a whole file of workarounds for that. If WebGL is unavailable `createWorld` throws and the wrapper rethrows during render so the page's `ErrorBoundary` shows the repo list.
- `world.ts` — the engine: renderer, post-processing (`postprocessing`: bloom, vignette, **linear** tone mapping — a filmic curve re-grades the palette, and in voxel art the palette is the picture; Khronos-neutral visibly oversaturated the night), OrbitControls, picking, camera flights, the frame loop and the frame governor. The build is spread over animation frames so the page keeps answering. Picking is a ray against one `Box3` per tree — never against voxel geometry. The resting view is offset right of centre on wide screens (`setViewOffset`) to clear the label card, and slides left while the detail panel is open. In development it exposes `window.__voxelWorld` (`scene`, `camera`, `controls`, `renderer`, `island`, `shared`).
- `volume.ts` — `Volume` (a dense box of voxel ids) and `meshVolume`, the mesher **everything** goes through: hidden-face culling plus baked per-vertex **ambient occlusion** (three-neighbour corner test, with the quad split along the diagonal that keeps the gradient continuous). The AO is most of the look; do not bypass the mesher with ad-hoc box meshes. A cell with index `i` occupies `[i, i+1]`.
- `materials.ts` — the one lit material (`MeshLambertMaterial` + `onBeforeCompile`) and the uniforms every mesh shares. Three patches: **baked lantern light** (`aGlow`, computed per vertex at build time, multiplied in at night — real point lights for dozens of lanterns would cost more than the rest of the frame), **voxel-by-voxel growth** (each voxel scales up from its own centre as the shared `uGrow` clock passes its birth time, so trees assemble trunk-first with zero CPU per frame), and **leaf flutter** displaced per voxel so cubes stay cubes. The same vertex patch is in the shadow depth material, or a tree's full shadow lies on the ground before the tree exists.
- `island.ts` — the island as a pure function of the tree positions. Its outline is the spiral's own outer envelope plus a margin, so 3 repos get a hillock and 60 get a mesa and neither has a bald half. Two kinds of thing live on it and must stay tellable apart: the **exhibit** is built (walk, brick planters squared to the grid, signs coloured by health, lanterns), the **wild** is hash-seeded (bushes, single-colour flower drifts, small trees) and is kept *shorter than the smallest repo tree* so a specimen is never mistaken for scenery. Water voxels and emissive voxels live in the same volume and are meshed into their own draw calls by `include`/`occludes` filters.
- `trees.ts` — the eight species as voxel sculptors. Each must stay recognisable **by silhouette alone**: oak (lumpy multi-blob crown), pine (stacked tiers), redwood (tall, thick, foliage only up top), sakura (low spreading umbrella), birch (thin white trunk, airy column), willow (dome with hanging curtain), palm (leaning trunk, drooping fronds), generic (rounded cube). Health is legible from across the island: leaf voxels turn through the legend's ramp one at a time, then start dropping. Crowns are hollowed (sealed leaf voxels are deleted) to keep triangle counts down.
- `sky.ts` — dome, stars, cubic sun and moon, the two lights, fog and the cloud ring. The theme toggle is an **animation, not a swap**: one eased `day` factor drives everything each frame, so flipping dark mode sets the sun and sweeps the shadows round. The camera looks *down* at the island, so the lower half of the dome is most of the background — the gradient and the stars cover the full sphere.
- `water.ts`, `particles.ts`, `labels.ts` — pixel-sparkle water and the dissolving waterfall ribbon; one instanced draw call for every loose cube in the air (petals, falling leaves, spray, smoke, pollen, fireflies), each a closed-form loop in the vertex shader; name tags drawn at an integer number of screen pixels per font pixel, fading in as the camera approaches.
- `math.ts` — hashes, seeded PRNG, value noise.

**Seeded determinism is load-bearing**: every source of variation derives from `hash3`/`seededRandom` keyed on position or `tree.id` — never `Math.random()`. The same repo list must build the same island on every visit.

**Budget**: 18 repos is ~110k triangles in ~37 draw calls; 64 repos is ~275k in ~83. Per frame the CPU writes a few uniforms, one easing value per tree, and the label fades.

**Reduced motion** (`hooks/usePrefersReducedMotion.ts`, `useSyncExternalStore`) gates the growth animation, leaf flutter, camera flights and auto-rotate, cloud drift, and the day↔night transition (which snaps). Particles settle at a fixed point of their loop (`uMotion`) rather than freezing mid-air.

**Quality** (`hooks/useQualityTier.ts`): the static tier (CPU hints only; `WEBGL_debug_renderer_info` is deliberately not read) picks a *starting* preset — DPR cap, shadow map size, MSAA samples, bloom, particle and decor multipliers. The engine's governor then measures real frame times and gives up resolution, then bloom; it never climbs back. It is disabled under `navigator.webdriver` so screenshots are deterministic.

**Verifying visual changes**: type-checking does not catch rendering bugs. Run `FOREST_MOCK=18 npm run dev` and screenshot with headless Chromium using SwiftShader (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`), waiting for `window.__voxelWorld` plus ~9 s for the growth animation; drive the camera through `__voxelWorld.camera`/`.controls`. Check both themes — dark is the default, so **night is the first impression**.

### Theming — must match `mertsoylu.dev`

This page ships on a subdomain of the owner's main portfolio (a separate Vite/React repo, not in this workspace) and is styled to feel like the same site, not a separate tool: same warm sand/clay CSS-variable palette (`--canvas`/`--surface`/`--fg`/`--muted`/`--accent`/…, light + `.dark` in `globals.css`), same Fraunces (display) + Inter (body) font pairing, same dark-default-with-toggle and TR/EN-toggle behavior — but with its **own** localStorage keys (`cv-orman-dark-mode`, `cv-orman-language`), independent of the main site's state.

`DarkModeContext`/`LanguageContext` read their persisted value via `useSyncExternalStore`, not `useState` + a `useEffect` that calls `setState` — the latter trips the `react-hooks/set-state-in-effect` lint rule and is the wrong tool for "synchronize with an external store" per React's own guidance. Both contexts' server snapshot is a fixed default (`true` / `"tr"`) matching the pre-hydration script in `app/layout.tsx`'s `<head>`, so server and first client render always agree — don't reintroduce a lazy `useState(() => localStorage...)` initializer, it reintroduces the hydration-mismatch risk this pattern was written to avoid.

Copy strings live in `lib/i18n/dict.ts` (`useT()` hook) — tr/en only, no i18n library.
