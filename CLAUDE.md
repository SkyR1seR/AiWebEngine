# aiWebEngine

Tiny WebGPU/WebGL2 3D game engine (TypeScript, no runtime deps). The user writes in Russian — reply in Russian.

- API reference & recipes: `docs/AI_GUIDE.md` — read it before writing game code.
- Games live in `games/<name>/` (create with `npm run new <name>`); examples in `examples/`. Both import `aiwebengine`, `aiwebengine/physics`, `/fx`, `/ui`, `/audio`, `/assets`, `/extras`, `/debug` (aliased to `src/` in vite.config.ts and tsconfig).
- Publishing: never upload sources. `npm run export <name> -- --yandex` → `export/<name>.zip`; Yandex games must call `ya.ready()` (see AI_GUIDE "Publishing"). Before handing a build to the user run `npm run smoke <name>` (headless Chrome, cross-origin iframe, fake SDK; must PASS on webgpu and webgl2). The dev server hides production-only bugs.
- Commands: `npm run dev` (http://localhost:5173/games/<name>/), `npm test`, `npm run typecheck`, `npm run size [name]`, `npm run analyze -- <main.ts>`.
- Browser preview config: `.claude/launch.json` (`dev` on 5173, `preview` of dist on 4173). The pane pauses the loop when hidden: advance manually with `game.stop(); for (...) game.frame(t += 1/60); game.start()` from the JS tool, then screenshot.

## Rules that keep the build small and correct
- Weight is the top priority: keep modules tree-shakeable (no top-level side effects; `/* @__PURE__ */` on module-level instances), prefer standalone functions for optional features, check `npm run size` after engine changes.
- Private class members are declared `private _name` and mangled by terser (`mangle.properties: /^_/`). Never access `_x` members from another module or chunk; never use `_`-prefixed keys for data objects.
- Backend chunks (`src/gpu/webgpu.ts`, `webgl2.ts`) are lazy-loaded and may only `import type` from core modules; runtime values come via `BackendEnv`. A value import from the main chunk deadlocks with top-level `await createGame()` (the build now fails on it: `no-dynamic-to-entry-imports`).
- Every built-in shader exists twice: `src/shaders/*.wgsl` and `*.glsl` (GLSL uses `#if VERTEX` / `#if FRAGMENT`). Keep them in sync; uniform structs are std140-identical (vec4-only). Projection uses WebGPU depth [0,1]; GLSL vertex shaders remap z.
- WebGPU `writeBuffer` calls all land before the frame's command buffer: data for different passes in one frame must use different buffers/offsets.
- Verify engine changes on both backends (`?backend=webgl2`, `?backend=webgpu`), with no console errors, and in the mobile viewport for UI changes.
