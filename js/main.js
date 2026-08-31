/**
 * 应用入口
 * 串联配置 → 状态 → 存档 → 引擎 → 双视图，完成首屏初始化与主循环启动
 * 所有跨层回调在此统一接线，避免模块间循环依赖
 */

import { getBranch } from './config/index.js';
import { getState, createRun, subscribe, notify, VIEW } from './core/state.js';
import { load, bindAutoSave, saveNow, remainingSeconds } from './core/storage.js';
import { setAdvance, onBeforeTick, startLoop, bindVisibility } from './core/loop.js';
import { advance, startMarch, onWipe } from './systems/march.js';
import { tickExtraction, onSettle, settleByWipe, computeTimeLimit } from './systems/extraction.js';
import { settle } from './systems/settlement.js';
import { makeSquadSnapshot, squadCombatStats } from './systems/operator.js';
import { makeLoadoutSnapshot } from './systems/equipment.js';
import { makeAmmoState, squadArmorLevel } from './systems/ammo.js';
import { squadBagCapacity } from './systems/readiness.js';
import { baseBonuses, makeMedicalRunSnapshot, makeMobilityRunSnapshot } from './systems/base.js';
import { toast } from './ui/components.js';
import { mountTopbar, renderTopbar } from './ui/topbar.js';
import { registerView, switchTo, renderCurrent, syncViewFromState } from './ui/router.js';
import {
  mountPrepare, renderPrepare, unmountPrepare, getPrepareEl, onLaunch, launchCheck, PREPARE_VIEW_NAME
} from './ui/prepare/index.js';
import {
  mountExplore, renderExplore, unmountExplore, getExploreEl, EXPLORE_VIEW_NAME
} from './ui/explore/index.js';
import { maybeShowSettlement } from './ui/settlement.js';

/** 出发：校验通过后创建 run 并进入探索视图 */
function launchRun() {
  const s = getState();

  if (s.run) {
    toast('行动已在进行中', 'warn');
    return;
  }

  const check = launchCheck(s);
  if (!check.ok) {
    toast(check.missing[0] || '出发条件不满足', 'err');
    return;
  }

  const { mapId, difficulty } = s.selection;
  const branch = getBranch(mapId, difficulty);
  if (!branch) {
    toast('所选行动不存在，请重新选择', 'err');
    return;
  }

  const stats = squadCombatStats(s);
  const now = Date.now();
  const loadoutSnapshot = makeLoadoutSnapshot(s);

  s.run = createRun({
    mapId,
    difficulty,
    timeLimit: computeTimeLimit(mapId, difficulty, s),
    startedAt: now,
    squadSnapshot: makeSquadSnapshot(s),
    loadoutSnapshot,
    maxHp: stats.hp,
    nodeGap: branch.nodeGap,
    ammo: makeAmmoState(s),
    armorLevel: squadArmorLevel(loadoutSnapshot, s.inventory),
    bagCapacity: squadBagCapacity(s),
    baseBonuses: baseBonuses(s),
    medical: makeMedicalRunSnapshot(loadoutSnapshot, s),
    mobility: makeMobilityRunSnapshot(s)
  });
  s.view = VIEW.EXPLORE;

  // 从准备阶段迁移到推进阶段
  startMarch(s, now);

  saveNow();
  switchTo(EXPLORE_VIEW_NAME);
  notify();
  toast('行动开始，注意撤离时限', 'ok');
}

/** 统一渲染入口：状态变更后刷新常驻信息栏与当前视图 */
function renderAll() {
  renderTopbar();
  syncViewFromState();
  renderCurrent();
  maybeShowSettlement();
}

function boot() {
  // 1. 读档与断点恢复
  const result = load();

  // 2. 常驻信息栏
  mountTopbar();

  // 3. 注册两个互斥视图
  registerView(PREPARE_VIEW_NAME, {
    el: getPrepareEl(),
    mount: mountPrepare,
    render: renderPrepare,
    unmount: unmountPrepare
  });
  registerView(EXPLORE_VIEW_NAME, {
    el: getExploreEl(),
    mount: mountExplore,
    render: renderExplore,
    unmount: unmountExplore
  });

  // 4. 接线跨层回调
  setAdvance(advance);
  onBeforeTick(tickExtraction); // 时限与撤离判定须先于推进
  onWipe(settleByWipe);
  onSettle(settle);
  onLaunch(launchRun);

  // 5. 订阅状态变更驱动渲染
  subscribe(renderAll);

  // 6. 首屏：依据存档决定落在哪个视图
  const s = getState();
  switchTo(s.run ? EXPLORE_VIEW_NAME : PREPARE_VIEW_NAME);
  renderAll();

  // 7. 启动主循环与生命周期绑定
  startLoop();
  bindVisibility();
  bindAutoSave();

  // 8. 恢复提示
  if (result.resumed && s.run) {
    if (result.expired) {
      toast('离线期间行动时限已耗尽，正在结算', 'warn');
    } else {
      toast(`行动已恢复，剩余 ${Math.ceil(remainingSeconds(s.run))} 秒`, 'ok');
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
