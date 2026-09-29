# aiWebEngine — API guide (for writing games fast)

Tiny WebGPU/WebGL2 engine. Everything is ESM + tree-shakeable; import only what you use.
Coordinates: right-handed, **+Y up**, cameras/lights look along **-Z**, glTF & mannequin models face **+Z**.
Colors are sRGB hex (`0xff8800`) and converted to linear internally. Units: meters, seconds, radians.

```ts
import { ... } from 'aiwebengine';          // core: game, scene, math, geometry, materials, tweens
import { ... } from 'aiwebengine/physics';  // PhysicsWorld, Body, shapes, CharacterController
import { ... } from 'aiwebengine/fx';       // Particles, presets, burst, Trail, PostFX, CameraShake, flash, punchScale
import { ... } from 'aiwebengine/ui';       // UI, h, u
import { sound } from 'aiwebengine/audio';  // sound.sfx('coin'), sound.play(url), sound.playMusic(url)
import { ... } from 'aiwebengine/assets';   // loadGLTF, Model
import { ... } from 'aiwebengine/extras';   // createMannequin, OrbitControls, FollowCamera
import { ... } from 'aiwebengine/debug';    // DebugDraw, statsOverlay
```

## Game & loop
```ts
const game = await createGame({ backend: 'auto', maxDpr: 2, dynamicResolution: true, antialias: true });
game.scene; game.camera; game.input; game.screen; game.renderer; game.time /* dt, elapsed, fps, scale */
game.onUpdate(dt => {});      // per frame (before scripts)
game.onFixedUpdate(dt => {}); // 60 Hz, before physics step
game.onLateUpdate(dt => {});  // after scripts+physics sync (camera logic)
game.onRender(dt => {});      // after render (UI sync)
game.addSystem(obj);          // { fixedUpdate?, update?(dt, alpha), preRender?, postRender? }
game.time.scale = 0.5;        // slow motion
```
Frame order: input → fixed steps (onFixedUpdate, systems.fixedUpdate = physics) → onUpdate → tweens → node scripts → systems.update (physics → nodes) → onLateUpdate → matrices → render → onRender.
Force backend: URL `?backend=webgl2|webgpu`. Tab hidden = paused.

## Scene graph
```ts
const n = scene.add(new Node('name'));       // add() returns the child
n.setPosition(x,y,z).setRotation(rx,ry,rz).setScale(s);   // Euler Y->X->Z
n.position / n.rotation (quat) / n.scale     // Float32Arrays, mutate directly
n.lookAt([x,y,z]); n.lookAt(p, true)         // true = model faces +Z
n.worldPosition(); n.forward(); n.find('name'); n.traverse(fn); n.clone(); n.destroy();
n.addScript((dt, node) => {}) or { start, update, destroy };  n.data = free storage
const m = new Mesh(geometry, material);  m.castShadow / receiveShadow / tint (rgba) / flash (rgb,a) / renderOrder / visible
```
Geometry: `box(w,h,d) plane(w,d,sx,sz) sphere(r,ws,hs) icosphere(r,detail) cylinder(rt,rb,h,seg) cone(r,h) capsule(r,h) torus(R,r) quad(w,h)`,
`geo.flatShade()` (low-poly look), `geo.setColor(r,g,b)`, `geo.transform(m4)`, `mergeGeometries([g...], [m4...])`, `geo.setAttribute('color', data, 4)`.
Instancing: `mesh.instances = new Instances(max, withColor)`; `inst.setMatrix(i, m4compose(m, pos, quat, scale))`, `inst.setColor(i, color(hex))`, `inst.count = n`.

## Materials
`lambert(hex, opts)`, `toon(hex, { steps: 2, rim: 0xffffff, rimStrength, specular, outline: { width: 0.03, color } })`,
`standard(hex, { metalness, roughness })`, `unlit(hex)`, or `new Material({ type, color, map, opacity, emissive, emissiveIntensity, blend: 'opaque'|'alpha'|'add', cull: 'back'|'none', alphaTest, fog, castShadow })`.
`mat.setColor(hex)`, `mat.opacity = 0.5` (set `blend:'alpha'` at creation), `mat.uniforms` (raw: color[0..3], emissive[4..7]; values >1 = HDR glow with PostFX bloom).
Textures: `await loadTexture(url)`, `checker()`, `softDot()`, `Texture.fromCanvas(canvas)`.

## Scene look
```ts
scene.setSky({ top, horizon, bottom, sun }) | scene.setBackground(hex)
scene.setAmbient(skyHex, groundHex, intensity)     // hemisphere light
scene.setFog(hex, near, far[, density])            // null to disable
scene.add(new DirectionalLight({ direction: [-.5,-1,-.3], intensity, color, shadow: { size: 2048, extent: 20 } }))
sun.shadowFocus = [x,y,z]                           // default follows camera position
scene.add(new PointLight(hex, intensity, range))   // up to 8 nearest
game.renderer.post = new PostFX({ bloom: { intensity, threshold }, tonemap: 'aces'|'none', vignette, fxaa, contrast, saturation, exposure });  post.fade = [r,g,b,a]
```

## Camera & adaptivity
`camera.fov` (vertical, deg), `camera.fit = 'height'|'width'|'contain'` + `camera.designAspect` (e.g. 9/16 for portrait games — 'contain' keeps the design frame visible on any screen), `camera.ortho/orthoSize`.
`camera.screenRay(x, y, game.screen.width, game.screen.height)` → { origin, dir }; `camera.worldToScreen(p, w, h)`.
`new OrbitControls(game, { target, distance, pitch, yaw, autoRotate })`; `new FollowCamera(game, node, { distance, lookHeight, physics, ignore: [body] })`, `cam.toWorld(inputX, inputY)` → camera-relative XZ, `cam.yaw`.
Screen: `game.screen.width/height` (CSS px), `.portrait`, `.safeArea`, `.scale` (dynamic resolution 0.5..1), `.onResize(fn)`.

## Input
`input.isDown('KeyW'|'Space'|'Mouse0'|'Pad0'|'jump')`, `wasPressed`, `wasReleased`, `anyPressed(...codes)`;
`input.move()` → [x, y] from WASD/arrows/gamepad/virtual joystick (y = forward); `input.look()` (right stick);
`input.pointer` {x,y,dx,dy,down,pressed,released,wheel}; `input.tap` {x,y}|null; `input.swipe` 'left'|'right'|'up'|'down'|null; `input.touches`; `input.lockPointer()`.

## Tweens & timers
`await tween(obj | typedArray, { x: 1 } | [0, 2, 0], seconds, { ease: 'backOut', delay, repeat: -1, yoyo, onComplete })`,
`await wait(0.5)`, `after(1, fn)`, `every(2, fn)` → cancel fn, `tweens.kill(target)`, `Ease.*`.

## Animation
Models: `const a = await loadGLTF('hero.glb', { material: 'toon', materialOptions: { outline: { width: 0.02 } } }); const hero = scene.add(a.instantiate());`
`hero.play('Run', { fade: 0.2, loop, speed })`, `hero.animator.playOnce('Attack', 'Idle')`, `animator.on('end'|'loop'|eventName, fn)`, `clip.addEvent(t, 'step')`, `animator.current`.
`createMannequin({ body, skin, legs, outline })` → Model with clips: idle, walk, run, jump, fall, attack(event 'hit'), wave (events 'step').
Custom clips: `new AnimationClip(name, [{ target: nodeName|index, path: 'position'|'rotation'|'scale', times, values, interp }])`, `animator.addClip(c)`.

## Physics
```ts
const world = game.addSystem(new PhysicsWorld({ gravity: [0,-9.81,0] }));
world.add(mesh, { type: 'static'|'dynamic'|'kinematic', shape: 'box'|'sphere'|'capsule'|'mesh' /* auto-fit to geometry */ | boxShape(hx,hy,hz) | sphereShape(r) | capsuleShape(r, halfHeight) | planeShape() | meshShape(geo),
  mass, friction, restitution, isTrigger, layer, mask, angularFactor: [0,1,0], linearDamping, gravityScale, offset })
body.applyImpulse(v, point?) / applyForce / setVelocity(x,y,z) / teleport(p, q) / velocity / sleeping / wake()
body.onCollide = (other, { point, normal, speed }) => {}; body.onCollideEnd; body.onTrigger = (other, 'enter'|'exit') => {}
world.raycast(origin, dir, maxDist, { mask, ignore }) → { body, point, normal, distance } | null
world.overlapSphere(c, r) / overlapBox(c, half) → Body[]; world.onContact(fn); world.remove(body); mesh.data.body
const ctrl = new CharacterController(world, node, { radius, height, stepHeight, maxSlope })
ctrl.move(vx, vz) every frame; ctrl.jump(speed) → bool; ctrl.grounded; ctrl.velocity; ctrl.onLand = speed => {}; ctrl.teleport(p)
```
Kinematic bodies with a node follow the node (moving platforms). Dynamic bodies drive their node (node must be a direct child of the scene or nested — both handled).
Static plane/mesh shapes only. Use raycasts for bullets (no CCD).

## Effects
```ts
const fire = scene.add(new Particles(presets.fire()));     // presets: fire smoke explosion sparks confetti dust magic collect hit snow
burst(scene, presets.explosion(), 60, pos);                // one-shot, auto-removed
new Particles({ max, rate, lifetime: [a,b], speed, shape: 'point'|'sphere'|'cone'|'box'|'ring', radius, angle, direction, gravity, drag,
  size: [start,end], color: [hex...], alpha: [..], randomColor, spin, blend: 'add'|'alpha', texture, sheet: {cols,rows}, intensity, worldSpace })
p.emit(n, at?); p.play(); p.stop();
scene.add(new Trail(targetNode, camera, { width, time, color, intensity }));
const shake = new CameraShake(game); shake.add(0.5);
flash(mesh, 0xffffff, 0.12); punchScale(node, 0.25); slowMotion(game, 0.2, 0.3);
```

## UI (DOM overlay, scales with screen)
```ts
const ui = new UI(game, { reference: [1280, 720] /* [720,1280] portrait */, match: 0.5 });
const score = ui.text('0', 'top-left'); score.set(10);            // anchors: top-left top top-right left center right bottom-left bottom bottom-right fill
ui.button('Play', () => {}, 'center', 'green'|'red'|'');
const hp = ui.bar(1, 'top-left'); hp.set(0.5);
ui.screen('menu', h('div', { class: 'ui-title' }, 'Title'), h('button', { class: 'ui-btn', onClick }, 'Go')); ui.show('menu'); ui.hide();
ui.worldLabel(node, 'Name', [0, 2, 0]); ui.floatText('+10', pos, '#ffd23f'); ui.toast('Saved');
ui.joystick({ side: 'left' }) /* touch only */; ui.touchButton('JUMP', 'jump') → input.isDown('jump')
u(24) → 'calc(var(--u)*24px)' for scaled custom CSS. Classes: ui-btn ui-panel ui-title ui-big ui-bar.
```

## Audio
`sound.sfx('jump'|'coin'|'hit'|'explosion'|'click'|'powerup'|'win'|'lose'|'shoot'|'step', volume)` (procedural, zero assets),
`sound.play(urlOrBuffer, { volume, pitch, pitchRandom, loop, pan })`, `sound.playMusic(url, vol, fade)`, `sound.mute()`, `sound.setVolume('music', .5)`.

## Debug
`statsOverlay(game)`; `const dbg = new DebugDraw(game); dbg.physics = world; dbg.line(a,b,hex); dbg.box(c,half); dbg.sphere(c,r)`.

## Math (Float32Array, output-first)
`v3(x,y,z) v3add(o,a,b) v3sub v3scale v3addScaled(o,a,b,s) v3dot v3cross v3len v3normalize v3lerp v3dist v3transformMat4 v3transformQuat`,
`quat() qeuler(o,x,y,z) qaxisAngle qmul qslerp qlookDir(o,dir) qfromTo`, `m4() m4compose(o,t,q,s) m4mul m4invert m4targetTo`,
`clamp lerp damp(rate, dt) smoothstep rand(a,b) randInt pick(arr) DEG color(hex)`.

## Workflow
- New game: `npm run new mygame` → `games/mygame/main.ts`; `npm run dev` → http://localhost:5173/games/mygame/
- Verify both backends (`?backend=webgl2`), mobile viewport, console errors.
- Size: `npm run size [name]`; bundle breakdown: `npm run analyze -- games/x/main.ts`. Tests: `npm test`.
- Weight tips: skip physics for simple games (AABB checks), use `Instances` for repeated meshes, procedural `sound.sfx`, `createMannequin` instead of assets, keep shadows `size: 1024` on mobile.
