# aiWebEngine

Лёгкий 3D-движок для веб-игр на TypeScript: **WebGPU с автоматическим фолбэком на WebGL2**, без runtime-зависимостей, полностью tree-shakeable. Спроектирован так, чтобы на нём было быстро и предсказуемо писать игры (в том числе ИИ-ассистенту): короткий типизированный API, одна точка входа `createGame()`, справочник в [docs/AI_GUIDE.md](docs/AI_GUIDE.md).

## Вес билдов (gzip, каждый пример собран отдельно)

| пример | что внутри | итого gzip | brotli |
|---|---|---|---|
| hello-cube | рендер, тени, toon/PBR, небо | **20.4 KB** | 18.3 KB |
| effects | + частицы, трейлы, bloom/ACES/FXAA | 29.1 KB | 25.9 KB |
| physics | + rigid body физика, debug-отрисовка | 33.8 KB | 29.6 KB |
| runner | гиперказуал: скелетная анимация, UI, звук, эффекты | 34.4 KB | 30.5 KB |
| character | всё сразу: физика, контроллер, камера, UI, звук, пост | 49.0 KB | 42.4 KB |

Бэкенд грузится динамически — в рантайме скачивается только один (WebGPU ≈5.5 KB или WebGL2 ≈5.7 KB). `npm run size` пересчитывает таблицу.

## Возможности

- **Рендер**: единый RHI над WebGPU/WebGL2, forward-рендер, материалы unlit / lambert / toon (полосы, rim, outline) / standard (metal-rough), направленный свет с PCF-тенями (стабилизированными), до 8 точечных источников, hemisphere ambient, туман, градиентное небо, инстансинг, скиннинг, фрустум-куллинг.
- **Адаптивность**: DPR-кап, динамическое разрешение по FPS, ресайз/ориентация, safe-area, камера с режимами `height | width | contain` под дизайн-аспект; DOM-UI масштабируется от эталонного разрешения (как CanvasScaler), якоря, экраны меню, виртуальный джойстик и кнопки, метки над объектами, всплывающий текст.
- **Эффекты**: CPU-частицы с GPU-инстансингом и 10 пресетами (огонь, дым, взрыв, искры, конфетти, пыль…), трейлы, пост-обработка (bloom, ACES, контраст/насыщенность, виньетка, fade, FXAA), тряска камеры, flash, punch-scale, slow-motion.
- **Физика**: сферы, боксы, капсулы, плоскости, статические тримеши с BVH; SAT + клиппинг для боксов, sequential impulses с warm start, трение, упругость, сон, слои/маски, триггеры, события столкновений, рейкасты и overlap-запросы, кинематические платформы, контроллер персонажа (ступеньки, склоны, прыжок с coyote time, толкание тел).
- **Анимации**: твины и таймеры (`await tween(...)`), скелетная анимация с кроссфейдом, весами и событиями, glTF/GLB загрузчик (меши, материалы, текстуры, скины, анимации, инстансы с общими GPU-данными), процедурный манекен с 7 анимациями для прототипов без ассетов.
- **Прочее**: ввод (клавиатура, мышь, тач, свайпы, тапы, геймпад, pointer lock), звук (WebAudio, шины, музыка с кроссфейдом, процедурные SFX без ассетов), orbit/follow-камеры с коллизией, debug-линии и оверлей статистики.

## Быстрый старт

```bash
npm install
npm run dev
```

Примеры: http://localhost:5173/examples/ (добавьте `?backend=webgl2` или `?backend=webgpu`).

Новая игра:

```bash
npm run new my-game
```

```ts
import { createGame, Mesh, DirectionalLight, box, toon } from 'aiwebengine';

const game = await createGame();
game.scene.setSky({});
game.scene.add(new DirectionalLight({ direction: [-0.5, -1, -0.3] }));
const cube = game.scene.add(new Mesh(box(), toon(0xff7a3d, { outline: { width: 0.03 } })));
game.camera.setPosition(0, 2, 5).lookAt([0, 0, 0]);
game.onUpdate((dt) => cube.setRotation(0, game.time.elapsed, 0));
```

## Команды

| команда | что делает |
|---|---|
| `npm run dev` | dev-сервер с примерами и играми |
| `npm run build` | продакшен-сборка всех примеров и игр в `dist/` |
| `npm run size [имя]` | вес каждой игры (gzip/brotli) |
| `npm run analyze -- путь/main.ts` | вклад модулей в бандл |
| `npm test` | юнит-тесты (математика, шейдерный препроцессор, физика, анимации, glTF) |
| `npm run typecheck` | проверка типов |
| `npm run new <имя>` | заготовка игры в `games/<имя>` |
| `npm run export <имя> -- --yandex` | архив `export/<имя>.zip` для Яндекс Игр (без `--yandex` — для любого хостинга) |
| `npm run smoke <имя>` | проверка экспорта как на портале: headless Chrome, iframe, фейковый SDK, WebGPU и WebGL2 |

## Публикация (Яндекс Игры)

Загружать нужно не исходники (`main.ts`), а собранный архив:

```bash
npm run export runner -- --yandex
```

Получится `export/runner.zip`: `index.html` в корне, JS-чанки в `assets/`, подключён `/sdk.js`. В коде игры SDK подключается через `aiwebengine/yandex`: `ready()`, gameplay start/stop, реклама с паузой и выключением звука, облачные сохранения, язык портала. Вне Яндекса все вызовы безопасно ничего не делают.

## Структура

```
src/core       математика, игровой цикл (createGame)
src/gpu        RHI, бэкенды webgpu.ts / webgl2.ts, препроцессор шейдеров
src/shaders    WGSL/GLSL (lit, sky, particles), минифицируются при сборке
src/render     рендерер, текстуры
src/scene      Node, Mesh, Camera, свет, Scene, Model
src/geometry   геометрия, примитивы, инстансы
src/materials  материалы
src/anim       твины, аниматор, скиннинг
src/assets     glTF/GLB
src/physics    мир, тела, коллизии, контроллер персонажа
src/fx         частицы, трейлы, пост-обработка, «сочность»
src/ui         адаптивный DOM-UI
src/audio      звук
src/extras     манекен, камеры
src/debug      debug-линии, статистика
examples/      hello-cube, physics, character, effects, runner
games/         ваши игры
```
