// Main menu with sections (levels, skins, ...). Each section is a UI screen; add new ones to SECTIONS in createMenu.
import { h, u, type UI } from 'aiwebengine/ui';
import { sound } from 'aiwebengine/audio';
import { skinPreview, type Skin } from './skins';
import type { Save } from './garage';

export interface MenuTexts {
  title: string; play: string; levels: string; skins: string; back: string; buy: string; select: string; selected: string; noMoney: string; level: string;
}

export interface MenuHooks {
  play(): void;
  pickLevel(n: number): void;
  pickSkin(s: Skin): void;
}

export function createMenu(ui: UI, save: () => Save, persist: () => void, skins: Skin[], T: MenuTexts, hooks: MenuHooks) {
  document.head.append(h('style', null, `
.menu-col{display:flex;flex-direction:column;gap:${u(14)};min-width:${u(320)}}
.menu-col .ui-btn{font-size:${u(28)}}
.menu-logo{font-size:${u(54)};font-weight:900;text-align:center;line-height:1;color:#7dff8a;text-shadow:0 ${u(4)} 0 #1f7f33,0 ${u(8)} ${u(16)} rgba(0,0,0,.5)}
.tiles{display:grid;gap:${u(10)};max-height:${u(430)};overflow:auto;padding:${u(4)}}
.lv{width:${u(84)};height:${u(84)};font-size:${u(30)};padding:0}
.lv.cur{outline:${u(4)} solid #ffd23f}
.lv.lock{filter:grayscale(1) brightness(.6)}
.skin{display:flex;flex-direction:column;align-items:center;gap:${u(6)};background:rgba(255,255,255,.07);border-radius:${u(14)};padding:${u(10)};width:${u(150)}}
.skin canvas{width:${u(48)};height:${u(96)}}
.skin.on{box-shadow:inset 0 0 0 ${u(3)} #7dff8a}
.skin .ui-btn{font-size:${u(16)};padding:${u(8)} ${u(12)}}
`));
  const click = (fn: () => void) => () => { sound.sfx('click', 0.5); fn(); };
  const btn = (label: string, cls: string, fn: () => void) => h('button', { class: 'ui-btn ' + cls, onClick: click(fn) }, label);

  // main
  const SECTIONS: [string, () => void][] = [
    [T.levels, () => showLevels()],
    [T.skins, () => showSkins()],
  ];
  ui.screen('menu', h('div', { class: 'menu-logo' }, ...T.title.split('\n').flatMap((l, i) => (i ? [h('br'), l] : [l]))),
    h('div', { class: 'menu-col' }, btn(T.play, 'green', () => hooks.play()), ...SECTIONS.map(([n, fn]) => btn(n, '', fn))));

  // levels
  const lvTiles = h('div', { class: 'tiles', style: { gridTemplateColumns: `repeat(5,${u(84)})` } });
  ui.screen('levels', h('div', { class: 'ui-title' }, T.levels), lvTiles, btn(T.back, '', () => show()));
  function showLevels() {
    const s = save(), n = Math.max(15, s.maxLevel + 6);
    lvTiles.replaceChildren();
    for (let i = 0; i < n; i++) {
      const open = i <= s.maxLevel;
      const b = h('button', { class: `ui-btn lv ${open ? 'green' : 'lock'} ${i === s.level ? 'cur' : ''}` }, open ? String(i + 1) : '🔒');
      b.addEventListener('click', () => {
        if (!open) { sound.sfx('hit', 0.3); return; }
        sound.sfx('click', 0.5);
        hooks.pickLevel(i);
      });
      lvTiles.append(b);
    }
    ui.hide();
    ui.show('levels');
  }

  // skins
  const coins = h('div', { class: 'ui-big gi', style: { color: '#ffe066' } });
  const skTiles = h('div', { class: 'tiles', style: { gridTemplateColumns: `repeat(3,${u(150)})` } });
  ui.screen('skins', h('div', { class: 'ui-title' }, T.skins), coins, skTiles, btn(T.back, '', () => show()));
  const previews = new Map<string, HTMLCanvasElement>();
  function showSkins() {
    const s = save();
    coins.textContent = `${s.coins}`;
    skTiles.replaceChildren();
    for (const sk of skins) {
      const owned = s.skins.includes(sk.id), on = s.skin === sk.id;
      let pv = previews.get(sk.id);
      if (!pv) previews.set(sk.id, (pv = skinPreview(sk.url)));
      const b = on ? h('div', { style: { fontWeight: '800', color: '#7dff8a' } }, T.selected)
        : h('button', { class: 'ui-btn ' + (owned ? '' : s.coins >= sk.price ? 'green' : 'red') }, ...(owned ? [T.select] : [`${T.buy} `, h('span', { class: 'gi' }, String(sk.price))]));
      if (!on) b.addEventListener('click', () => {
        if (!owned) {
          if (s.coins < sk.price) { ui.toast(T.noMoney); sound.sfx('hit', 0.3); return; }
          s.coins -= sk.price;
          s.skins.push(sk.id);
          sound.sfx('coin');
        } else sound.sfx('click', 0.5);
        s.skin = sk.id;
        persist();
        hooks.pickSkin(sk);
        showSkins();
      });
      skTiles.append(h('div', { class: 'skin' + (on ? ' on' : '') }, pv, h('div', { style: { fontWeight: '700' } }, sk.name), b));
    }
    ui.hide();
    ui.show('skins');
  }

  function show() { ui.hide(); ui.show('menu'); }
  return { show, showLevels, showSkins, get open() { return ['menu', 'levels', 'skins'].some((n) => ui.isShown(n)); } };
}
