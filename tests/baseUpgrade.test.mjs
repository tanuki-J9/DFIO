import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FACILITY,
  FACILITY_COSTS,
  FACILITY_META,
  FACILITY_ORDER,
  facilityCost
} from '../js/config/index.js';
import { createInitialState, subscribe } from '../js/core/state.js';
import {
  consumableCollectibleCount,
  facilityUpgradeView,
  protectedCollectibleCount,
  upgradeFacility,
  validateFacilityUpgrade
} from '../js/systems/base.js';
import { sellCollectible } from '../js/systems/collection.js';

const BLUE_IDS = [
  'm_can', 'm_caliper', 'm_fuel_low', 'm_fuel_bottle',
  'm_insignia', 'm_thermo', 'm_aramid', 'm_pirate_coin'
];

test('defines exactly nine upgrade-cost rows for every facility', () => {
  assert.ok(Object.isFrozen(FACILITY_COSTS));
  FACILITY_ORDER.forEach((id) => {
    assert.equal(FACILITY_COSTS[id].length, 9);
    for (let level = 2; level <= 10; level += 1) {
      assert.equal(facilityCost(id, level), FACILITY_COSTS[id][level - 2]);
    }
  });
  assert.equal(facilityCost(FACILITY.ARMORY, 1), null);
  assert.equal(facilityCost(FACILITY.ARMORY, 11), null);
  assert.equal(facilityCost('unknown', 2), null);
});

test('uses the exact shared coin and material quantities without exceeding ten items', () => {
  const expected = [
    [25000, [3], 0],
    [60000, [3, 1], 0],
    [150000, [2], 0],
    [350000, [3, 1], 0],
    [700000, [4, 1], 0],
    [1500000, [4, 2], 0],
    [3000000, [5, 3], 0],
    [6000000, [3, 3], 1],
    [12000000, [2, 4], 2]
  ];
  FACILITY_ORDER.forEach((id) => {
    for (let level = 2; level <= 10; level += 1) {
      const cost = facilityCost(id, level);
      const [hafCoin, poolCounts, redCount] = expected[level - 2];
      assert.equal(cost.hafCoin, hafCoin);
      assert.deepEqual(cost.items.filter((row) => row.kind === 'pool').map((row) => row.count), poolCounts);
      assert.equal(cost.items.filter((row) => row.kind === 'collectible')
        .reduce((sum, row) => sum + row.count, 0), redCount);
      assert.ok(cost.items.reduce((sum, row) => sum + row.count, 0) <= 10);
      assert.ok(Object.isFrozen(cost));
      assert.ok(Object.isFrozen(cost.items));
    }
  });
});

test('uses flexible pools for blue and gold costs plus facility-specific purple pools', () => {
  const expectedPools = {
    [FACILITY.COMMAND_CENTER]: {
      purple: ['m_ssd', 'm_ram'], gold: ['c_pass', 'c_server']
    },
    [FACILITY.ARMORY]: {
      purple: ['m_cutlass', 'm_pe'], gold: ['c_judgement', 'c_crossbow']
    },
    [FACILITY.ARMOR]: {
      purple: ['m_aramid', 'm_dressing'], gold: ['c_gazelle', 'c_cable']
    },
    [FACILITY.STORAGE]: {
      purple: ['m_fuel_low', 'm_fuel_bottle'], gold: ['c_cable', 'c_coffee']
    },
    [FACILITY.INTELLIGENCE]: {
      purple: ['m_ssd', 'm_thermal'], gold: ['c_haf_file', 'c_asara_file']
    },
    [FACILITY.MEDICAL]: {
      purple: ['m_dressing', 'm_humidifier'], gold: ['c_coffee', 'c_pass']
    },
    [FACILITY.MOBILITY]: {
      purple: ['m_fuel_low', 'm_fuel_bottle', 'm_pe'], gold: ['c_fuel_rod', 'c_cable']
    }
  };

  FACILITY_ORDER.forEach((id) => {
    assert.deepEqual(FACILITY_META[id].purpleIds, expectedPools[id].purple);
    assert.deepEqual(FACILITY_META[id].goldIds, expectedPools[id].gold);
    assert.deepEqual(facilityCost(id, 2).items, [{ kind: 'pool', ids: BLUE_IDS, count: 3 }]);
    assert.deepEqual(facilityCost(id, 3).items, [
      { kind: 'pool', ids: BLUE_IDS, count: 3 },
      { kind: 'pool', ids: expectedPools[id].purple, count: 1 }
    ]);
    assert.deepEqual(facilityCost(id, 5).items[1], {
      kind: 'pool', ids: expectedPools[id].gold, count: 1
    });
  });
});

test('requires the exact protected duplicate reds at levels nine and ten', () => {
  const expectedReds = {
    [FACILITY.COMMAND_CENTER]: {
      9: [{ id: 'c_blue_censer', count: 1 }],
      10: [{ id: 'c_blue_censer', count: 1 }, { id: 'c_exp_data', count: 1 }]
    },
    [FACILITY.ARMORY]: {
      9: [{ id: 'c_gpu', count: 1 }],
      10: [{ id: 'c_gpu', count: 2 }]
    },
    [FACILITY.ARMOR]: {
      9: [{ id: 'c_blue_plate', count: 1 }],
      10: [{ id: 'c_blue_plate', count: 2 }]
    },
    [FACILITY.STORAGE]: {
      9: [{ id: 'c_ocean_tear', count: 1 }],
      10: [{ id: 'c_ocean_tear', count: 2 }]
    },
    [FACILITY.INTELLIGENCE]: {
      9: [{ id: 'c_exp_data', count: 1 }],
      10: [{ id: 'c_exp_data', count: 2 }]
    },
    [FACILITY.MEDICAL]: {
      9: [{ id: 'c_bee_medic', count: 1 }],
      10: [{ id: 'c_bee_medic', count: 2 }]
    },
    [FACILITY.MOBILITY]: {
      9: [{ id: 'c_reactor_core', count: 1 }],
      10: [{ id: 'c_reactor_core', count: 2 }]
    }
  };

  FACILITY_ORDER.forEach((id) => {
    [9, 10].forEach((level) => {
      const reds = facilityCost(id, level).items
        .filter((row) => row.kind === 'collectible')
        .map(({ id: redId, count, protectFirst }) => ({ id: redId, count, protectFirst }));
      assert.deepEqual(reds, expectedReds[id][level].map((row) => ({ ...row, protectFirst: true })));
    });
  });
});

function upgradeState(id, level, { centerLevel = 10, commanderLevel = 30 } = {}) {
  const s = createInitialState();
  s.commander.level = commanderLevel;
  s.base.facilities.commandCenter = centerLevel;
  s.base.facilities[id] = level;
  s.currency.hafCoin = 20_000_000;
  s.materials = {};
  s.collectibles = {};
  return s;
}

function levelNineArmoryState(gpuCount = 2) {
  const s = upgradeState(FACILITY.ARMORY, 8, { centerLevel: 9 });
  s.materials.m_pe = 3;
  s.collectibles.c_judgement = 3;
  if (gpuCount > 0) s.collectibles.c_gpu = gpuCount;
  return s;
}

const LEVEL_NINE_ARMORY_PICKS = {
  poolPicks: [
    { tplId: 'm_pe', count: 3 },
    { tplId: 'c_judgement', count: 3 }
  ]
};

test('facility upgrade notifies once on success and never on rejected validation', () => {
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  let notifications = 0;
  globalThis.requestAnimationFrame = (callback) => { callback(0); return 1; };
  const unsubscribe = subscribe(() => { notifications += 1; });

  try {
    const s = upgradeState(FACILITY.ARMORY, 1, { centerLevel: 2 });
    s.currency.hafCoin = 25_000;
    s.materials.m_can = 3;

    assert.equal(upgradeFacility(FACILITY.ARMORY, {
      poolPicks: [{ tplId: 'm_can', count: 3 }]
    }, s).ok, true);
    assert.equal(notifications, 1);

    assert.equal(upgradeFacility(FACILITY.ARMORY, {
      poolPicks: [{ tplId: 'm_can', count: 3 }]
    }, s).ok, false);
    assert.equal(notifications, 1);
  } finally {
    unsubscribe();
    if (originalAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});

test('command center upgrades obey commander-level gates without mutation', () => {
  const s = upgradeState(FACILITY.COMMAND_CENTER, 1, { centerLevel: 1, commanderLevel: 2 });
  s.materials.m_can = 3;
  const before = structuredClone(s);

  const result = upgradeFacility(FACILITY.COMMAND_CENTER, {
    poolPicks: [{ tplId: 'm_can', count: 3 }]
  }, s);

  assert.equal(result.ok, false);
  assert.match(result.msg, /指挥官.*3/);
  assert.deepEqual(s, before);
});

test('non-command facilities cannot upgrade above command center level', () => {
  const s = upgradeState(FACILITY.ARMORY, 1, { centerLevel: 1 });
  s.materials.m_can = 3;
  const before = structuredClone(s);

  const result = upgradeFacility(FACILITY.ARMORY, {
    poolPicks: [{ tplId: 'm_can', count: 3 }]
  }, s);

  assert.equal(result.ok, false);
  assert.match(result.msg, /指挥中心.*2/);
  assert.deepEqual(s, before);
});

test('facility level ten is a hard upgrade cap', () => {
  const s = upgradeState(FACILITY.ARMORY, 10);
  const before = structuredClone(s);
  const result = upgradeFacility(FACILITY.ARMORY, { poolPicks: [] }, s);
  assert.equal(result.ok, false);
  assert.match(result.msg, /上限/);
  assert.deepEqual(s, before);
});

test('only duplicate red collectibles are consumable', () => {
  const s = levelNineArmoryState(2);
  assert.equal(protectedCollectibleCount('c_gpu', s), 1);
  assert.equal(consumableCollectibleCount('c_gpu', s), 1);

  s.collectibles.c_gpu = 1;
  assert.equal(protectedCollectibleCount('c_gpu', s), 1);
  assert.equal(consumableCollectibleCount('c_gpu', s), 0);
});

test('fixed red costs reject another red and protect the first required copy', () => {
  const wrongRed = levelNineArmoryState(0);
  wrongRed.collectibles.c_ocean_tear = 2;
  const wrongBefore = structuredClone(wrongRed);
  const wrongResult = upgradeFacility(FACILITY.ARMORY, LEVEL_NINE_ARMORY_PICKS, wrongRed);
  assert.equal(wrongResult.ok, false);
  assert.match(wrongResult.msg, /显卡/);
  assert.deepEqual(wrongRed, wrongBefore);

  const firstOnly = levelNineArmoryState(1);
  const firstBefore = structuredClone(firstOnly);
  const firstResult = upgradeFacility(FACILITY.ARMORY, LEVEL_NINE_ARMORY_PICKS, firstOnly);
  assert.equal(firstResult.ok, false);
  assert.match(firstResult.msg, /可消耗|重复/);
  assert.deepEqual(firstOnly, firstBefore);
});

test('pool picks must match every pool count and allowed ID exactly', () => {
  const s = upgradeState(FACILITY.ARMORY, 2, { centerLevel: 3 });
  s.currency.hafCoin = 60_000;
  s.materials = { m_can: 4, m_pe: 1 };

  const tooFew = validateFacilityUpgrade(FACILITY.ARMORY, {
    poolPicks: [{ tplId: 'm_can', count: 3 }]
  }, s);
  assert.equal(tooFew.ok, false);
  assert.match(tooFew.msg, /4/);

  const noPurple = validateFacilityUpgrade(FACILITY.ARMORY, {
    poolPicks: [{ tplId: 'm_can', count: 4 }]
  }, s);
  assert.equal(noPurple.ok, false);
  assert.match(noPurple.msg, /材料池/);

  const exact = validateFacilityUpgrade(FACILITY.ARMORY, {
    poolPicks: [
      { tplId: 'm_can', count: 3 },
      { tplId: 'm_pe', count: 1 }
    ]
  }, s);
  assert.equal(exact.ok, true);
  assert.deepEqual(exact.plan.materials, { m_can: 3, m_pe: 1 });
  assert.deepEqual(exact.plan.collectibles, {});
  assert.equal(exact.plan.hafCoin, 60_000);
});

test('invalid pool selections and malformed warehouse state roll back the full upgrade transaction', () => {
  const invalidPicks = upgradeState(FACILITY.ARMORY, 2, { centerLevel: 3 });
  invalidPicks.currency.hafCoin = 60_000;
  invalidPicks.materials = { m_can: 4, m_pe: 1 };
  const invalidBefore = structuredClone(invalidPicks);

  const invalidResult = upgradeFacility(FACILITY.ARMORY, {
    poolPicks: [{ tplId: 'm_can', count: 4 }]
  }, invalidPicks);

  assert.equal(invalidResult.ok, false);
  assert.match(invalidResult.msg, /材料池/);
  assert.deepEqual(invalidPicks, invalidBefore);

  const malformed = upgradeState(FACILITY.ARMORY, 1, { centerLevel: 2 });
  malformed.currency.hafCoin = 25_000;
  malformed.materials = { m_can: '3' };
  const malformedBefore = structuredClone(malformed);

  const malformedResult = upgradeFacility(FACILITY.ARMORY, {
    poolPicks: [{ tplId: 'm_can', count: 3 }]
  }, malformed);

  assert.equal(malformedResult.ok, false);
  assert.match(malformedResult.msg, /库存数据异常/);
  assert.deepEqual(malformed, malformedBefore);
});

test('overlapping pool IDs still require an exact assignment to every row', () => {
  const s = upgradeState(FACILITY.STORAGE, 2, { centerLevel: 3 });
  s.currency.hafCoin = 60_000;
  s.materials = { m_can: 4, m_fuel_low: 4 };

  assert.equal(validateFacilityUpgrade(FACILITY.STORAGE, {
    poolPicks: [{ tplId: 'm_can', count: 4 }]
  }, s).ok, false);

  assert.equal(validateFacilityUpgrade(FACILITY.STORAGE, {
    poolPicks: [
      { tplId: 'm_can', count: 3 },
      { tplId: 'm_fuel_low', count: 1 }
    ]
  }, s).ok, true);

  assert.equal(validateFacilityUpgrade(FACILITY.STORAGE, {
    poolPicks: [{ tplId: 'm_fuel_low', count: 4 }]
  }, s).ok, true);
});

test('validation is pure and returns an aggregated normalized debit plan', () => {
  const s = levelNineArmoryState(2);
  const before = structuredClone(s);
  const result = validateFacilityUpgrade(FACILITY.ARMORY, {
    poolPicks: [
      { tplId: 'm_pe', count: 1 },
      { tplId: 'c_judgement', count: 3 },
      { tplId: 'm_pe', count: 2 }
    ]
  }, s);

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan, {
    facilityId: FACILITY.ARMORY,
    fromLevel: 8,
    targetLevel: 9,
    hafCoin: 6_000_000,
    materials: { m_pe: 3 },
    collectibles: { c_gpu: 1, c_judgement: 3 }
  });
  assert.deepEqual(s, before);
});

test('insufficient currency or inventory leaves the entire state unchanged', () => {
  const noCoin = upgradeState(FACILITY.ARMORY, 1, { centerLevel: 2 });
  noCoin.currency.hafCoin = 24_999;
  noCoin.materials.m_can = 3;
  const noCoinBefore = structuredClone(noCoin);
  assert.equal(upgradeFacility(FACILITY.ARMORY, {
    poolPicks: [{ tplId: 'm_can', count: 3 }]
  }, noCoin).ok, false);
  assert.deepEqual(noCoin, noCoinBefore);

  const noMaterials = upgradeState(FACILITY.ARMORY, 1, { centerLevel: 2 });
  noMaterials.currency.hafCoin = 25_000;
  noMaterials.materials.m_can = 2;
  const noMaterialsBefore = structuredClone(noMaterials);
  assert.equal(upgradeFacility(FACILITY.ARMORY, {
    poolPicks: [{ tplId: 'm_can', count: 3 }]
  }, noMaterials).ok, false);
  assert.deepEqual(noMaterials, noMaterialsBefore);
});

test('successful upgrade commits every debit together and preserves gallery history', () => {
  const s = levelNineArmoryState(2);
  s.gallery.c_gpu = { at: 1234, count: 2 };
  const galleryBefore = structuredClone(s.gallery);

  const result = upgradeFacility(FACILITY.ARMORY, LEVEL_NINE_ARMORY_PICKS, s);

  assert.equal(result.ok, true);
  assert.equal(result.level, 9);
  assert.equal(s.base.facilities.armory, 9);
  assert.equal(s.currency.hafCoin, 14_000_000);
  assert.equal(s.materials.m_pe, undefined);
  assert.equal(s.collectibles.c_judgement, undefined);
  assert.equal(s.collectibles.c_gpu, 1);
  assert.deepEqual(s.gallery, galleryBefore);
});

test('facility upgrade view exposes gates and protected-red availability', () => {
  const s = levelNineArmoryState(2);
  const view = facilityUpgradeView(FACILITY.ARMORY, s);
  assert.equal(view.level, 8);
  assert.equal(view.targetLevel, 9);
  assert.equal(view.gate.ok, true);
  assert.deepEqual(view.collectibles.map(({ id, required, protected: locked, consumable, missing }) => ({
    id, required, protected: locked, consumable, missing
  })), [{ id: 'c_gpu', required: 1, protected: 1, consumable: 1, missing: 0 }]);
});

test('selling a red collectible consumes duplicates but preserves its protected copy and gallery', () => {
  const s = levelNineArmoryState(2);
  s.gallery.c_gpu = { at: 1234, count: 2 };
  const galleryBefore = structuredClone(s.gallery);

  const sold = sellCollectible('c_gpu', 2, s);
  assert.equal(sold.ok, true);
  assert.equal(s.collectibles.c_gpu, 1);
  assert.deepEqual(s.gallery, galleryBefore);

  const protectedBefore = structuredClone(s);
  const protectedResult = sellCollectible('c_gpu', 1, s);
  assert.equal(protectedResult.ok, false);
  assert.match(protectedResult.msg, /保护/);
  assert.deepEqual(s, protectedBefore);
});
