import test from 'node:test';
import assert from 'node:assert/strict';

import { AMMO_TEMPLATES } from '../js/config/equipment.js';
import {
  renderEquipmentPanel,
  setEquipSubTab
} from '../js/ui/prepare/equipmentPanel.js';
import {
  renderWarehousePanel,
  setWarehouseCat
} from '../js/ui/prepare/warehousePanel.js';

test('equipment ammo page renders visual ammo cards instead of text-only cards', () => {
  setEquipSubTab('ammo');
  const html = renderEquipmentPanel();

  assert.match(html, /data-item-kind="ammo"/);
  assert.match(html, /item-art--lg/);
});

test('equipment shop renders visual equipment cards', () => {
  setEquipSubTab('shop');
  const html = renderEquipmentPanel();

  assert.match(html, /data-item-kind="weapon"/);
  assert.match(html, /item-art--lg/);
});

test('warehouse ammo inventory renders visual ammo cards', () => {
  setWarehouseCat('ammo');
  const html = renderWarehousePanel();

  assert.match(html, /item-art item-art--lg item-art--ammo/);
  assert.match(html, /2 级全被甲弹/);
  assert.match(html, /库存 240 发/);
});

test('configured external image flows from ammo config into the rendered page', () => {
  const tpl = AMMO_TEMPLATES[0];
  const previous = tpl.imageUrl;
  tpl.imageUrl = '/assets/ammo/am-t1.webp';

  try {
    setEquipSubTab('ammo');
    const html = renderEquipmentPanel();
    assert.match(html, /src="\/assets\/ammo\/am-t1\.webp"/);
  } finally {
    if (previous === undefined) delete tpl.imageUrl;
    else tpl.imageUrl = previous;
  }
});
