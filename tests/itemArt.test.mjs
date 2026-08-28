import test from 'node:test';
import assert from 'node:assert/strict';
import { itemArt } from '../js/ui/itemArt.js';

test('renders a typed CSS pixel placeholder when an item has no external image', () => {
  const html = itemArt({
    slot: 'weapon',
    name: 'M4A1 卡宾枪',
    rarity: 'rare',
    level: 3
  }, { size: 'lg' });

  assert.match(html, /class="item-art item-art--lg item-art--weapon rar-bg-rare"/);
  assert.match(html, /data-item-kind="weapon"/);
  assert.match(html, /<span class="item-art-level">3<\/span>/);
  assert.doesNotMatch(html, /<img/);
});

test('prefers an escaped external image when imageUrl is configured', () => {
  const html = itemArt({
    kind: 'ammo',
    name: '3级弹药 <测试>',
    rarity: 'epic',
    level: 3,
    imageUrl: 'https://cdn.example.com/ammo-3.png?x=1&y=2'
  });

  assert.match(html, /class="item-art item-art--md item-art--ammo rar-bg-epic has-image"/);
  assert.match(html, /<img class="item-art-image"/);
  assert.match(html, /src="https:\/\/cdn\.example\.com\/ammo-3\.png\?x=1&amp;y=2"/);
  assert.match(html, /alt="3级弹药 &lt;测试&gt;"/);
});

test('accepts the future image field as an alias for imageUrl', () => {
  const html = itemArt({
    slot: 'armor',
    name: '重型防弹衣',
    rarity: 'legend',
    level: 5,
    image: '/assets/equipment/armor-5.webp'
  }, { size: 'sm', showLevel: false });

  assert.match(html, /item-art--sm/);
  assert.match(html, /src="\/assets\/equipment\/armor-5\.webp"/);
  assert.doesNotMatch(html, /item-art-level/);
});

test('uses the concrete equipment slot instead of the generic equipment kind', () => {
  const html = itemArt({
    kind: 'equipment',
    slot: 'helmet',
    name: '战术头盔',
    rarity: 'rare',
    level: 4
  });

  assert.match(html, /item-art--helmet/);
  assert.match(html, /data-item-kind="helmet"/);
});
