// Shared UI building blocks (owner: ui-core). Everything is DOM inside ui.root; sizes via u().
import type { Ctx, Drop, Rarity, Reward } from './types';
import type { IconId } from './textures';

type Child = HTMLElement | SVGElement | string | number | null | undefined | false;

/** layer container in ui.root: hud(z1) screen(z5) top(z8) modal(z10) toast(z12) */
export function layer(ctx: Ctx, name: 'hud' | 'screen' | 'top' | 'modal' | 'toast'): HTMLElement { throw new Error('TODO' + ctx + name); }
/** pixel icon <i> element, size in UI units */
export function icon(id: IconId, sizeU = 28): HTMLElement { throw new Error('TODO' + id + sizeU); }
/** "[coin] 1 234" / "[gem] 50" */
export function money(kind: 'coins' | 'gems', n: number | string, sizeU = 26): HTMLElement { throw new Error('TODO' + kind + n + sizeU); }
/** themed button with click sound; cls: '' | 'green' | 'blue' | 'gold' | 'red' | 'ad' | 'small' | 'big' (space separated) */
export function btn(content: Child | Child[], onClick: () => void, cls = ''): HTMLButtonElement { throw new Error('TODO' + content + onClick + cls); }
/** purple "watch an ad" button with the video icon */
export function adBtn(label: string, onClick: () => void, cls = ''): HTMLButtonElement { throw new Error('TODO' + label + onClick + cls); }

export interface Panel { el: HTMLElement; title: HTMLElement; body: HTMLElement; show(): void; hide(): void; readonly visible: boolean }
/** full-screen screen layer with a framed snowy panel, title and a back button (back defaults to ctx.nav.menu) */
export function makeScreen(ctx: Ctx, title: string, opts?: { back?: () => void; wide?: boolean }): Panel { throw new Error('TODO' + ctx + title + opts); }
/** modal popup over everything; closable shows an X */
export function modal(ctx: Ctx, content: Child[], opts?: { title?: string; onClose?: () => void; closable?: boolean; cls?: string }): { el: HTMLElement; close(): void } { throw new Error('TODO' + ctx + content + opts); }
/** tab strip */
export function tabs<T extends string>(items: { id: T; label: string }[], onSelect: (id: T) => void): { el: HTMLElement; select(id: T): void; setDot(id: T, on: boolean): void } { throw new Error('TODO' + items + onSelect); }
export function rarityName(r: Rarity): string { throw new Error('TODO' + r); }
export function rarityBadge(r: Rarity): HTMLElement { throw new Error('TODO' + r); }
/** element whose text counts down to endsAt every second while connected (prefix e.g. "⏱ ") */
export function countdown(ctx: Ctx, endsAt: number, prefix = '', onEnd?: () => void): HTMLElement { throw new Error('TODO' + ctx + endsAt + prefix + onEnd); }
/** red notification dot on an element */
export function dot(el: HTMLElement, on: boolean): void { throw new Error('TODO' + el + on); }
/** square art for a reward/drop/item: skin figure, ball icon, case, coins pile, gems, key, no-ads */
export function itemArt(kind: 'skin' | 'ball' | 'key' | 'coins' | 'gems' | 'noAds', id?: string, sizeU = 96): HTMLElement { throw new Error('TODO' + kind + id + sizeU); }
/** short label of a reward ("+500", "Дед Мороз", "Ледяной подарок x3") */
export function rewardLabel(r: Reward | Drop): string { throw new Error('TODO' + r); }
/** "Получено!" popup listing drops (dups show "+X coins"); resolves when closed */
export function showRewards(ctx: Ctx, drops: Drop[], title?: string): Promise<void> { throw new Error('TODO' + ctx + drops + title); }
export function toast(ctx: Ctx, msg: string, kind: 'info' | 'good' | 'bad' = 'info'): void { throw new Error('TODO' + ctx + msg + kind); }
/** confirm dialog → true if confirmed */
export function confirmBox(ctx: Ctx, text: string, ok: string, cancel?: string): Promise<boolean> { throw new Error('TODO' + ctx + text + ok + cancel); }

/** currency bar (coins, gems with "+" → shop) shown over menu screens */
export class TopBar {
  el!: HTMLElement;
  constructor(ctx: Ctx) { void ctx; }
  update(): void {}
  show(on: boolean): void { void on; }
}
