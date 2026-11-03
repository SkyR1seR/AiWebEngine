# «Нубик: Снежная гонка» / "Noob: Snowball Rush" — design & module contracts

Blocky (voxel, "cubic sandbox" look) New-Year racing game about **Нубик (Noob)** — the hero, whose skin is
`images/noob.png` (the author's own asset from games/noobRideMaster; classic 64x32 layout). Every racer pushes a snowball
that grows on snow. Big balls smash numbered ice walls and obstacles, bridge ice holes and extinguish bonfires; obstacles
shatter small balls. A race = one level, 5 racers: Нубик (the player) + 4 bots that pretend to be online players
("fake online"). Revenue: ads first (interstitial between races + many rewarded placements), IAP second (gem packs,
offers). Platform SDK: **Playgama Bridge** (`aiwebengine/playgama`, `ctx.sdk`), one build for Yandex Games, CrazyGames,
Playgama, VK and others. Languages: 19 (see §9).

**Copyright rules (hard):** generic voxel look. Never use the words Minecraft/Mojang/Creeper/Steve/Herobrine/Enderman/
"craft" in names, no textures/sounds/fonts from that game. The only image file is the author's Нубик skin; everything else
(textures, other skins, icons) is drawn procedurally in code (our own pixel art). Font: Pixelify Sans (OFL, `fonts/`).
Music: public-domain melodies only (Jingle Bells — Pierpont 1857; We Wish You a Merry Christmas — traditional).

## 0. Ground rules for code
- TypeScript, engine imports: `aiwebengine`, `aiwebengine/fx`, `aiwebengine/ui`, `aiwebengine/audio`, `aiwebengine/playgama`.
  Read `docs/AI_GUIDE.md`. No physics module (custom simple sim). No external network requests, no new npm deps.
- Private members `private _x`; never `_`-prefixed keys in data objects (terser mangles `_` props).
- **i18n:** see §9 — `tr({ ru, en })` from `./i18n` inside functions; whole phrases with `${}` placeholders.
- `types.ts`, `util.ts`, `i18n.ts` are shared contracts (owner: lead). You may ADD optional fields to interfaces you own
  (see owner tags in types.ts) with a small Edit; never rename/remove existing exported names or change signatures.
- Every exported signature in the stub files is a contract other modules code against. Keep them; add more exports freely.
- Tests: `tests/snowball-*.test.ts` (vitest). `npm run typecheck` must pass for your files.
- Keep code compact and commented where non-obvious; performance matters on phones (60 fps, low draw calls, no per-frame
  allocations in hot loops, reuse DOM nodes, update DOM only on change).
- Platform requirements (Playgama): no Esc key usage, no long-press text selection / context menu / iOS magnifier,
  every popup has a close button or a clear exit, nothing cut off at any aspect ratio incl. 1:1, no page scrolling.

## 1. World & units
- 1 block = 1 m. +Y up. The track runs along **-Z**: distance along the track `d` (meters, >= 0) maps to world `z = -d`.
  Lateral `x` in `[-6.5, 6.5]`; track is `TRACK_W = 13` cells wide, cell `c` (0..12) is centered at `x = c - 6`;
  row `r` covers `d ∈ [r, r+1)`. Floor top surface at `y = 0`.
- Characters: blocky humanoid 1.44 m tall (skin pixel = 0.045 m, 32 px tall), feet at y=0, model faces +Z; racers are
  rotated by π (they run toward -Z). Standard 64x64 box-skin UV layout (head 8x8x8 at (0,0), hat overlay (32,0), body
  8x12x4 at (16,16), right arm 4x12x4 (40,16), left arm (32,48), right leg (0,16), left leg (16,48)). The 64x32 noob.png
  is converted to 64x64 at load (left limbs = mirrored right limbs).
- Ball: size number `s` shown to players (integer `Math.round(s)`), radius `r = s / 10` meters. Start size 3 (+upgrade),
  max 30. Ball center at `(ballX, r, ballD)` with `ballD = d + r + 0.45` (ball rolls in FRONT of the racer);
  `ballX` follows `x` with lag. Rolling angle `ballRot += Δd / r`.
- Camera (race): behind & above the player: pos `(x*0.6, 4.5 + r*1.2, -(d - 6.5 - r*1.4))`, looks at `(x*0.8, 0.8, -(d + 7))`.
  vertical FOV 58 (portrait 68). Smoothly damped.

## 2. Gameplay rules (sim.ts is the single source of truth)
Forward speed `v = BASE(6.4) * speedMul * surfaceMul * sizeMul * boostMul * rubber`, accelerates at 9 m/s².
`surfaceMul`: snow 1, ice 1.15, thaw 0.92, salt 0.92, boost pad → `boostT = 1.6s` (x1.45). `sizeMul = 1 - 0.008*max(0, s-12)` (min 0.82).
Steering: racer moves `x` toward `targetX` at up to 8.5 m/s (on ice: acceleration limited → slippery). x clamped to
`±(6.5 - 0.35)`; ball x clamped so the ball stays inside the track `±(6.5 - r*0.8)`.
Surfaces (under the BALL center): snow → grow `ds/dm = 0.42 * growMul / (1 + s/22)` per meter rolled, ice → nothing,
thaw → `-3.2 * meltMul` size/s, salt → `-6 * meltMul` size/s. Size < 2 → ball melts away (`shatter` cause 'melt', no stun),
a new ball of start size appears.

Obstacles (`Obstacle.kind`) — collisions use the ball circle `(ballX, ballD, r)` and the racer box `(x ±0.3, d ±0.3)`:
| kind | shape | rule |
|---|---|---|
| `wall` | box `x±w, d±len` (len 0.5), 3 m high, shows its remaining strength | `s >= strengthLeft` → smash (shared: broken for everybody), `s -= 0.3*strength`. Else: ball shatters, racer stunned 0.7 s, pushed back 1.2 m, and the wall is chipped: `strengthLeft -= 0.5*s` (shared) — nobody can get stuck. Walls come in rows spanning the track (2–4 sections; one section always has strength <= 3). |
| `spikes` | ice spikes `x±w, d±0.5` | destructible like a wall (strength 8..16), else shatter + stun 0.6 |
| `fire` | bonfire circle radius `w` | `s >= strength` (≈20+) → extinguish (smash), cost 0.3*strength. Else continuous melt 16 size/s while overlapping (racer is not blocked) |
| `hammer` | pendulum: pivot `(x, d)` at height 4.5, arm length `w`, head circle r 0.75 at `x + w*sin(θ)`, `θ = 1.15*sin(speed*t + phase)` | indestructible; hit → shatter + stun 0.8 + lateral knock |
| `pusher` | gift box 1.6 m cube sliding: `x(t) = x + amp*sin(speed*t + phase)` | destructible (strength ~14..20), else shatter + stun 0.6 |
| `plow` | snowplow 2.4 x 1.6, crosses the whole track: triangle wave `x(t)` in `[-5, 5]` at `speed` m/s, phase offset | indestructible; shatter + stun 1.0 |
| `icicle` | falls at `(x, d)` radius `w`(0.8): cycle `period` s, shadow warning for the last 1.0 s, impact window 0.35 s | indestructible; hit during impact → shatter + stun 0.6 |
| `gap` | ice hole across the full width, rows `d-len .. d+len` | when the ball reaches it: if ball x-range lies on an existing bridge → roll over. Else if `s >= strength` → the ball plugs the hole: `bridge` event (shared bridge `x0..x1` = ballX ± max(0.9, r)), ball consumed; the racer walks across (x clamped to the bridge), new start-size ball after the hole. Else → racer and ball fall in (`fall`, 1.5 s), respawn just past the hole with a start-size ball. |
| `bonus` | full-width wall after the finish, `mult` x1.2/x1.5/x2/x3/x4/x5, rising strengths | per racer (not shared): `s >= strength` → `bonus` event, `s -= 0.5*strength`, racer.mult = mult; else the ball shatters there and the racer is `done`. After the last wall → `done`. |
Shield (from gift or `armor` upgrade) absorbs one shatter (the obstacle is smashed instead if destructible; indestructible → racer just passes, brief flash).
Pickups: `coin` (shared, first come; magnet radius), `gem` (rare, 0–1 per level), `gift` → random power-up:
`shield` | `boost` (x1.4, 2.5 s) | `grow` (+6 size). Racer-vs-racer: balls are circles that push each other apart laterally
(heavier = bigger pushes more), racers' bodies too — no damage.
Start: countdown 3-2-1-GO; racers at `d = 1.5`, x = [-4.8,-2.4,0,2.4,4.8], player at x = 0. Finish line at `finishD`; finish
order = places 1..5. After crossing, bots drift to the side and cheer; the player continues into the bonus zone.
Race ends (results) when the player is `done`. Placing 1–3 passes the level (level++, tries = 0), 4–5 = retry (tries++).

## 3. Difficulty: smooth curve, easier on every retry (level.ts / bots.ts)
- `difficulty(n) = 1 - exp(-n / 14)` (0 → 0, 10 → 0.51, 20 → 0.76, 40 → 0.94). Every generator parameter interpolates on
  `k = difficulty(n) * (1 - ease)`: obstacle density, wall strengths relative to the expected size, hole requirements,
  moving-obstacle speed, coin risk; bot skill `= (0.2 + 0.65 * k)`, rubber band generosity.
- `ease = easeFor(save.tries) = min(0.5, 0.15 * tries)`: a retry uses the SAME seed (layout stays familiar) but is easier —
  some obstacles removed (deterministically, the hardest first), lower requirements, slower bots, kinder rubber band.
  The UI says so ("Попытка 3 — уровень стал легче!").
- Level length: `finishD = 140 + 9*n` capped at 420 (≈25 s → ≈70 s).
- New mechanics one at a time, every 2 levels, the first appearance is a single calm instance:
  n=0 snow, coins, easy spikes, one wall row; n=1 boost pads; n=2 fire; n=4 gap; n=6 pusher; n=8 hammer;
  n=10 thaw/salt/ice patches; n=12 icicle; n=14 plow; later only density/combination grows. `newKinds(n)` lists the kinds
  first appearing in level n (intro cards).

## 4. Bots / fake online (bots.ts)
- Opponent profiles: realistic nicknames (international + Russian gamer-style mix; no offensive words, no celebrities),
  skins (mostly common: noob/winter/skier/hockey — other "noobs"; sometimes premium skins → show-off), ball skins,
  trophies near the player's (±25%), sometimes a "VIP" crown.
- AI: lookahead 10–30 m by skill; evaluates the 13 lanes: snow good (+), coins (+ small), thaw/salt (−), walls/spikes/
  pushers: cost depends on whether `s >= strength` (prefer smash when cheap/rewarding, avoid otherwise), fire (−− unless
  can extinguish), gaps (prefer existing bridge; bridge if big enough), moving obstacles predicted by time-to-reach.
  Reaction delay 0.12–0.5 s, target noise, mistake chance, steering smoothing. `skill ∈ [0,1]`.
- Rubber band (`applyRubberBand(sim, player, ease)` each step): bot far ahead → 0.93..0.97, far behind → 1.03..1.08.
  Level 0 (first race) is tuned so the player wins; early levels: decent play → top-3 ~85%, 1st ~50%.
- Emotes: bots occasionally show bubbles ("GG", "😎", "😭", "❄️", "🎄", "lol", "ахах"...) on events (overtake, shatter,
  finish 1st, start). Rarely (3%) one bot "disconnects" mid race (fades out, toast).
- Matchmaking screen: "Поиск соперников…", slots fill one by one over 2–4 s with avatars/nicks/trophies, fake
  "online now" counter, then "Соперники найдены!".

## 5. Meta & economy (catalog.ts, save.ts, offers.ts, payments.ts, unlocks.ts)
Currencies: **coins** (soft: races, ads) and **gems / «кристаллы»** (hard: tiny amounts from play — daily calendar,
league-ups, rare gem pickups — main source is IAP).
- Upgrades (coins), max levels: `speed` 20 (+2.5%/lvl), `grip` 20 (+6% growth/lvl), `armor` 20 (−3.5% melt/lvl; shields:
  1 at lvl 5, 2 at lvl 12, 3 at lvl 20), `start` 15 (+1 start size/lvl), `magnet` 15 (pickup radius 0.9 + 0.12/lvl).
  Cost `round(60 * 1.27^lvl)` (rounded to 5). Free upgrade level for a rewarded ad (cooldown 10 min). The very first
  upgrade is free (tutorial freebie).
- Race reward coins: `(placeBase[place] + collected) * mult` where placeBase = (25 + 4*level) * [1, .7, .5, .3, .2];
  x2 for a rewarded ad. Trophies: +30/+18/+8/−6/−12 (never below 0). Leagues by trophies: 0 Снежинка, 150 Сосулька,
  400 Метель, 800 Вьюга, 1400 Северное сияние, 2200 Ледяной король, 3200 Дед Мороз; first reach gives 5..40 gems.
- Skins: 14 character skins — `noob` (Нубик, default, the PNG), `winter` (Нубик в шапке: noob skin + knitted hat & scarf,
  given free when the wardrobe unlocks), then costumes: skier, hockey, penguin, elf, gingerbread, snowman, reindeer,
  snowmaiden, iceknight, santa (Дед Мороз), yeti, nutcracker. 9 ball skins. Rarities common/rare/epic/legendary.
  Commons for coins, rares/epics for gems or from cases, some exclusive to offers/cases. "Try for one race" via rewarded ad.
- Cases («Подарки»): `snow` (30 gems, or free via ad every 4 h; the first one is free), `ice` (90 gems), `santa` (250 gems).
  Duplicates → coins (common 150, rare 400, epic 1000, legendary 2500). Pity: legendary within 25 `ice`/`santa` opens.
  Roulette strip opening animation; "Шансы" popup lists drop chances. Case keys (`save.keys`) from calendar / offers.
- Daily «Новогодний календарь»: 7-day loop (coins, case key, gems, ...), claim once per calendar day, red dot in menu.
- Offers (timers everywhere):
  - Starter pack (IAP `starter_pack`): 48 h from the moment the shop unlocks (`save.unlockedAt.shop`), once:
    300 gems + epic skin `iceknight` + 3000 coins, "−90%".
  - Hot deal: rotates every 6 h (deterministic by window index), bought with gems, −40..−60%.
  - New Year mega pack (IAP `newyear_pack`): legendary `santa` skin + `gold` ball + 800 gems; window Dec 1 – Jan 15
    (outside it the same pack is shown as «Зимний набор» with a 3-day rolling timer).
  - Comeback offer after 2 losses in a row (cheap gem offer, once per session).
  - Free: case every 4 h for an ad, +coins for an ad in the shop (cooldown 3 min, 10/day).
- IAP products (ids in `playgama-bridge-config.json` and in each platform's dashboard): `gems_60`, `gems_330`,
  `gems_700`, `gems_1500`, `gems_4000`, `starter_pack`, `newyear_pack`, `no_ads` (permanent: disables interstitials).
  Playgama: `sdk.purchase(id)` → grant → `sdk.consume(id)` for consumables; on start `sdk.purchases()` → grant+consume
  leftovers, restore `no_ads`. Hide/disable IAP when `sdk.paymentsSupported` is false (local test mode on localhost).
- Ads (`ctx.sdk`): interstitial `showAd('race_end')` after a race when continuing — only from level `ADS_FROM_LEVEL` (3),
  never after the first race of a session, ≥ 60 s apart (the SDK also enforces it), skipped with no_ads; rewarded
  placements: `double_reward`, `free_case`, `free_coins`, `free_upgrade`, `try_skin`, `daily_double`. Hide ad buttons
  when `sdk.rewardedSupported` is false (show them disabled with "недоступно" in dev only).

## 6. Module map & owners
| file | owner | purpose |
|---|---|---|
| `types.ts`, `util.ts`, `i18n.ts`, `DESIGN.md`, `lang/*.json` | lead | shared contracts, localization |
| `config.ts`, `level.ts`, `sim.ts`, `bots.ts`, `controls.ts` | core | gameplay logic (no rendering) |
| `catalog.ts`, `save.ts`, `offers.ts`, `payments.ts`, `unlocks.ts` | meta | economy, content data, persistence, IAP, unlocks |
| `textures.ts`, `blocks.ts`, `skinart.ts`, `character.ts` | art | procedural pixel art, voxel geometry, characters, balls |
| `world.ts`, `racerview.ts`, `camera.ts`, `lobby.ts`, `fx.ts` | world | 3D level, racer visuals, camera, menu backdrop, particles |
| `theme.ts`, `widgets.ts` | ui-base | style + shared widgets |
| `hud.ts`, `menu.ts`, `matchmaking.ts`, `results.ts`, `tutorial.ts` | ui-core | main screens + tutorial UI |
| `shop.ts`, `casesui.ts`, `wardrobe.ts`, `upgradesui.ts`, `daily.ts`, `offersui.ts` | ui-store | monetization screens |
| `audio.ts` | audio | music + sfx |
| `race.ts`, `main.ts` | integrator | race orchestration, state machine, wiring, tutorial script |

## 7. UI conventions (theme.ts defines them)
- UI scale: `--u = clamp(min(W, H) / 720, 0.4, 2.5)` → portrait screens are ≥ 720 units wide, landscape ≥ 720 units tall.
  Size everything with `u(n)` from `aiwebengine/ui`. Must work at 360x640 portrait, 640x360 landscape, 1:1 squares,
  1920x1080. Use `@media (orientation: portrait)` for layout differences. Lists scroll inside their panel.
  Texts in other languages can be ~40% longer than English: use flexible widths, wrapping, `min-width` instead of fixed
  widths, shrink long labels (`font-size` clamp) — never overflow.
- Layers inside `ui.root`: `.lay-hud` (z 1), `.lay-screen` (z 5), `.lay-top` (z 8: currency bar), `.lay-modal` (z 10),
  `.lay-toast` (z 12). Screens are absolutely positioned full-size containers.
- Style: blocky pixel UI — Pixelify Sans font (system font for ja/ko/zh/hi/ar/th/vi: `html:lang(xx)` selectors), square
  corners, 3-unit black outlines, bevels; panels look like snowy wooden/stone frames with a snow cap; buttons: `.btn`
  (stone gray), `.green`, `.blue`, `.gold`, `.red`, `.ad` (purple with a "video" icon); rarity colors: common #9aa4ad,
  rare #3f8cff, epic #b350ff, legendary #ffb31a. Garland of blinking colored bulbs on the top edge of the menu.
- Icons are pixel art from `textures.iconURL(id)`; currency shows as `[icon] 12 345`.
- Every button plays `sfx('click')`. Buttons are big enough for fingers (≥ 64 units tall for primary actions).

## 8. Tutorial & gradual unlocking
- First race (level 0) is scripted by race.ts with `tutorial.coach` bubbles from Нубик + slow motion (game.time.scale):
  1) "Веди пальцем влево-вправо" (+ animated hand; keyboard text on desktop) — the race runs at 0.35 speed until the
  player has steered ~1.5 m; 2) on first growth: "На снегу ком растёт!"; 3) ~15 m before the first wall row: slow-mo +
  "Число на стене — какой нужен ком, чтобы её пробить. Выбирай стену поменьше своего кома!"; 4) coins: "Собирай монеты";
  5) bonus zone: "Бонусные стены умножают награду!". Bots in level 0 are slow — the player wins the first race.
- New obstacle kinds: before a race whose level introduces kinds not in `save.seen` → `tutorial.introCard(kind)` (art,
  name, one-line rule), then mark seen; the first encounter in the race gets a short slow-mo + hint.
- Menu features unlock by `save.level` (levels passed): upgrades 1, wardrobe 2, daily 2, cases 3, shop 4
  (`unlocks.UNLOCK_LEVEL`). Locked buttons are visible but grayed with a lock and "Ур. N" — tapping shows a toast.
  On unlock (`unlocks.pendingUnlocks`) the menu shows `tutorial.unlockPopup` + a pulsing hand on the button; first visit
  guidance with coach bubbles: first upgrade free, first snow case free, wardrobe gift `winter` skin.
- Offers/IAP appear only once the shop is unlocked; interstitials only from level 3.

## 9. Languages
Supported (`i18n.LANGS`): en, ru, uk, tr, es, pt, de, fr, it, pl, nl, ja, ko, zh, id, vi, hi, ar, th (be/kk/uz/... → ru,
unknown → en). Language from `sdk.lang` (platform), then `setLang()` + `await loadLang()` before the UI is built.
Code only ever writes `tr({ ru: '…', en: '…' })` (or `Loc` objects `{ ru, en }` passed to tr): the other languages are
dictionaries `lang/<code>.json` keyed by the English string, generated by the lead's extraction tool and translated.
Therefore: (1) every user-visible text goes through tr() with both ru and en; (2) one complete phrase per string — use
template literals with `${}` for numbers/names inside the phrase (`en: \`Level ${n}\``), never glue fragments;
(3) no `lang === 'ru'` branches; (4) keep English strings natural and unambiguous (they are the translation source);
(5) don't build texts from Russian-only grammar helpers outside the ru branch.

## 10. Flow (main.ts)
boot: `playgama()` ∥ `createGame()` → `setLang(sdk.lang)` + `loadLang()` → `loadSkinAssets()` → load save
(`normalize(await sdk.load())`) → `applyTheme()` → payments init + restore → lobby → menu → `sdk.ready()`.
Menu: Play → (intro cards for new obstacle kinds) → matchmaking (level generated with ease + world built meanwhile) →
race (countdown → run → finish → bonus zone) → results (x2 ad, next/retry/menu, interstitial) → menu / next race.
Unlock popups and the daily calendar pop on menu entry when pending; starter offer pops after a race once the shop is
unlocked (once per session); comeback offer after 2 losses.
