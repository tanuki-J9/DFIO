/**
 * 自动推进与节点事件引擎
 * 全部耗时基于绝对时间戳差值，后台切换回前台后进度仍正确（边界情况 8）
 */

import {
  getBranch, ENEMY_TIERS, ELITE_TIERS, OPERATOR_TIERS, BOSS_TIERS,
  ELITE_CHANCE, OPERATOR_CHANCE, ENEMY_CLASS, ENEMY_SKILLS, ENEMY_GEAR_LEVELS,
  getEnemyArt, EQUIPMENT_TEMPLATES, AMMO_TEMPLATES, LEVELED_SLOTS,
  COMBAT, FX_LIMIT, DIFFICULTY_META, clampGearLevel, penetrationMul
} from '../config/index.js';
import { getState, notify, pushLog, setPhase, PHASE, FAIL_REASON } from '../core/state.js';
import { phaseElapsed, phaseProgress } from '../core/storage.js';
import { nonNeg, randFloat, randInt, weightedPick, pick, uid, clamp } from '../core/utils.js';
import { squadCombatStats } from './operator.js';
import {
  tickMarchOperatorSkills, tickCombatOperatorSkills, enemyDisabled,
  ensureSquadMembers, activeMembers, squadIsWiped, selectEnemyTarget,
  memberSmokeEvade, applyMemberDamage, syncSquadHp
} from './operatorSkills.js';
import { rollCrateTier, rollCrateLoot, rollKillLoot, addToCarry, lootKindLabel } from './loot.js';
import { takeNextNode } from './nodePlan.js';
import {
  hasAmmo, consumeAmmo, shotMultiplier, ROUNDS_PER_TICK, targetArmorLevel
} from './ammo.js';

export const NODE_TYPE = { CRATE: 'crate', ENEMY: 'enemy', BOSS: 'boss' };

/** 演出特效入队，带同屏数量上限保护（边界情况 11） */
export function pushFx(type, payload = {}) {
  const run = getState().run;
  if (!run) return;
  if (!Array.isArray(run.fx)) run.fx = [];
  run.fx.push({ id: uid('fx'), type, at: Date.now(), ...payload });
  if (run.fx.length > FX_LIMIT) run.fx.splice(0, run.fx.length - FX_LIMIT);
}

/** 取出并清空特效队列，供演出层消费 */
export function drainFx() {
  const run = getState().run;
  if (!run || !Array.isArray(run.fx)) return [];
  const list = run.fx;
  run.fx = [];
  return list;
}

/** 当前行动的分支配置 */
export function currentBranch(s = getState()) {
  const run = s.run;
  if (!run) return null;
  return getBranch(run.mapId, run.difficulty);
}

/** 进入推进状态并设定到下一节点的耗时 */
export function startMarch(s = getState(), at = Date.now()) {
  const run = s.run;
  if (!run) return;
  const stats = squadCombatStats(s);
  const marchCut = clamp(nonNeg(stats.marchSpeed, 0), 0, 0.65);
  const gap = Math.max(0.6, nonNeg(run.nodeGap, 3) * (1 - marchCut) * randFloat(0.85, 1.15));
  run.node = null;
  if (run.phase === PHASE.MARCH) {
    run.phaseStartedAt = at;
    run.phaseDuration = gap;
    notify();
  } else {
    setPhase(PHASE.MARCH, { duration: gap, at });
  }
}

/** 触发一个新节点 */
function triggerNode(s, at) {
  const run = s.run;
  const branch = currentBranch(s);
  if (!run || !branch) return;

  run.nodeIndex += 1;
  const type = takeNextNode(run, branch) || NODE_TYPE.CRATE;

  if (type === NODE_TYPE.CRATE) enterCrate(s, branch, at);
  else enterCombat(s, branch, type === NODE_TYPE.BOSS, at);
}

/* ============ 补给箱 ============ */

export function enterCrate(s, branch, at) {
  const run = s.run;
  const stats = squadCombatStats(s);
  const { tier, conf } = rollCrateTier(branch.crateTier, stats.crateTierBonus);

  // 搜刮耗时随箱体稀有度提升而增加，并受搜刮效率缩减
  const speedCut = clamp(stats.scavengeSpeed, 0, 0.75);
  const duration = Math.max(0.8, nonNeg(conf.duration, 3) * (1 - speedCut));
  const lootConf = { rarity: conf.rarity, rolls: Math.max(1, tier), hafCoin: hafRangeByTier(tier) };
  const pendingLoot = rollCrateLoot(lootConf, stats.lootBonus);

  run.node = {
    kind: NODE_TYPE.CRATE,
    tier,
    name: conf.name,
    rarity: conf.rarity,
    duration,
    pendingLoot
  };

  setPhase(PHASE.SCAVENGE, { duration, at });
  pushLog('crate', `发现${conf.name}，开始搜刮…`);
  pushFx('crate-open', { rarity: conf.rarity });
}

export function finishCrate(s, at) {
  const run = s.run;
  const node = run.node;
  if (!node) { startMarch(s, at); return; }

  const stats = squadCombatStats(s);
  const conf = { rarity: node.rarity, rolls: (node.tier || 1), hafCoin: hafRangeByTier(node.tier) };
  const loot = resolveCrateLoot(
    node,
    () => rollCrateLoot({ ...conf, rolls: Math.max(1, node.tier) }, stats.lootBonus)
  );
  const gained = addToCarry(loot, s);

  run.counters.crates += 1;
  s.stats.crates += 1;
  s.stats.totalLoot += gained;

  const names = loot.map((it) => `${lootKindLabel(it)}·${it.name}${it.count > 1 ? `×${it.count}` : ''}`).join('、');
  pushLog('loot', `${node.name}搜刮完成：${names}（+${Math.round(gained)} 价值）`);
  loot.forEach((it) => pushFx('loot-pop', { text: `+${it.name}`, rarity: it.rarity }));

  startMarch(s, at);
}

/**
 * 新节点在搜刮开始时已经确定物品，完成时只结算同一份结果。
 * fallback 仅用于兼容更新前已经停留在搜刮阶段的旧存档。
 */
export function resolveCrateLoot(node, fallback) {
  if (Array.isArray(node?.pendingLoot)) return node.pendingLoot;
  return typeof fallback === 'function' ? fallback() : [];
}

function hafRangeByTier(tier) {
  const map = { 1: [120, 320], 2: [320, 780], 3: [800, 1900], 4: [1800, 4200], 5: [3600, 8800] };
  return map[tier] || map[1];
}

/* ============ 交战 ============ */

/** 应用敌方干员的被动技能到属性上 */
function applyEnemySkills(unit, skills) {
  let hp = unit.hp;
  let atk = unit.atk;
  let def = unit.def;
  let drain = 0;
  let evade = 0;
  let healPct = 0;
  skills.forEach((sk) => {
    if (!sk) return;
    if (sk.kind === 'tough') hp = Math.round(hp * (1 + sk.value));
    else if (sk.kind === 'sharp') atk = Math.round(atk * (1 + sk.value));
    else if (sk.kind === 'plated') def = Math.round(def * (1 + sk.value));
    else if (sk.kind === 'drain') drain += sk.value;
    else if (sk.kind === 'evade') evade += sk.value;
    else if (sk.kind === 'medic') healPct += sk.value;
  });
  return { hp, atk, def, drain, evade: clamp(evade, 0, 0.6), healPct: clamp(healPct, 0, 0.35) };
}

/** 为敌方干员随机生成携带装备（击杀后归我方） */
function rollEnemyGear(tier) {
  const levels = ENEMY_GEAR_LEVELS[tier] || ENEMY_GEAR_LEVELS[1];
  const out = [];
  // 随机 1-3 件带等级的装备
  const picks = randInt(1, 3);
  for (let i = 0; i < picks; i += 1) {
    const slot = pick(LEVELED_SLOTS);
    const pool = EQUIPMENT_TEMPLATES.filter(
      (t) => t.slot === slot && levels.includes(clampGearLevel(t.level))
    );
    const tpl = pick(pool);
    if (tpl) out.push(tpl.id);
  }
  // 必定携带一份对应档位的弹药（击杀后按发缴获）
  const ammoPool = AMMO_TEMPLATES.filter((t) => levels.includes(clampGearLevel(t.level)));
  const ammoTpl = pick(ammoPool);
  if (ammoTpl) out.push(ammoTpl.id);
  return out;
}

/** 取敌方单位的有效防具等级：以该档位单位自身等级为基准 */
function enemyArmorLevel(tier, bonus = 0) {
  const base = ENEMY_TIERS[tier]?.level || 1;
  return clampGearLevel(base + bonus);
}

/**
 * 构造敌方单位
 * @param {string} cls ENEMY_CLASS 之一
 */
function buildEnemy(mapId, branch, cls) {
  const tier = branch.enemyTier;
  const base = ENEMY_TIERS[tier] || ENEMY_TIERS[1];
  const art = getEnemyArt(mapId);

  if (cls === ENEMY_CLASS.BOSS) {
    const boss = BOSS_TIERS[tier] || BOSS_TIERS[1];
    const hp = Math.round(nonNeg(base.hp, 1) * boss.hpMul);
    return {
      cls,
      name: pick(art.boss.names) || boss.name,
      art: art.boss.art || '',
      atk: Math.round(nonNeg(base.atk, 1) * boss.atkMul),
      hp,
      maxHp: hp,
      def: Math.round(nonNeg(base.def, 0) * boss.defMul),
      armorLevel: enemyArmorLevel(tier, boss.levelUp),
      ammoLevel: enemyArmorLevel(tier, boss.levelUp),
      lootTier: boss.lootTier,
      skills: [],
      drain: 0,
      evade: 0,
      healPct: 0,
      carried: [],
      isBoss: true
    };
  }

  if (cls === ENEMY_CLASS.OPERATOR) {
    const conf = OPERATOR_TIERS[tier] || OPERATOR_TIERS[1];
    const size = randInt(conf.squadSize[0], conf.squadSize[1]);
    // 编队人数直接放大整体强度与掉落
    const rawHp = Math.round(nonNeg(base.hp, 1) * conf.hpMul * size);
    const skills = [];
    const skillCount = Math.min(ENEMY_SKILLS.length, size);
    const bag = [...ENEMY_SKILLS];
    for (let i = 0; i < skillCount; i += 1) {
      const idx = randInt(0, bag.length - 1);
      skills.push(bag.splice(idx, 1)[0]);
    }
    const carried = [];
    for (let i = 0; i < size; i += 1) carried.push(...rollEnemyGear(tier));

    const tuned = applyEnemySkills(
      {
        hp: rawHp,
        atk: Math.round(nonNeg(base.atk, 1) * conf.atkMul),
        def: Math.round(nonNeg(base.def, 0) * conf.defMul)
      },
      skills
    );

    const name = pick(art.operator.names) || '敌方干员';
    return {
      cls,
      name: size > 1 ? `${name} 小队（${size} 人）` : name,
      art: art.operator.art || '',
      squadSize: size,
      atk: tuned.atk,
      hp: tuned.hp,
      maxHp: tuned.hp,
      def: tuned.def,
      armorLevel: enemyArmorLevel(tier, conf.levelUp),
      ammoLevel: enemyArmorLevel(tier, conf.levelUp),
      lootTier: conf.lootTier,
      skills,
      drain: tuned.drain,
      evade: tuned.evade,
      healPct: tuned.healPct,
      carried,
      isBoss: false
    };
  }

  if (cls === ENEMY_CLASS.ELITE) {
    const conf = ELITE_TIERS[tier] || ELITE_TIERS[1];
    const hp = Math.round(nonNeg(base.hp, 1) * conf.hpMul);
    return {
      cls,
      name: pick(art.elite.names) || '精英单位',
      art: art.elite.art || '',
      atk: Math.round(nonNeg(base.atk, 1) * conf.atkMul),
      hp,
      maxHp: hp,
      def: Math.round(nonNeg(base.def, 0) * conf.defMul),
      armorLevel: enemyArmorLevel(tier, conf.levelUp),
      ammoLevel: enemyArmorLevel(tier, conf.levelUp),
      lootTier: conf.lootTier,
      skills: [],
      drain: 0,
      evade: 0,
      healPct: 0,
      carried: [],
      isBoss: false
    };
  }

  // 普通单位：战力很弱，有装备基本都能打过
  const hp = nonNeg(base.hp, 1);
  return {
    cls: ENEMY_CLASS.NORMAL,
    name: pick(art.normal.names) || base.name,
    art: art.normal.art || '',
    atk: nonNeg(base.atk, 1),
    hp,
    maxHp: hp,
    def: nonNeg(base.def, 0),
    armorLevel: clampGearLevel(base.level),
    ammoLevel: clampGearLevel(base.level),
    lootTier: base.lootTier,
    skills: [],
    drain: 0,
    evade: 0,
    healPct: 0,
    carried: [],
    isBoss: false
  };
}

/** 普通交战节点内再细分：敌方干员 → 精英 → 普通 */
function rollEnemyClass(branch) {
  const tier = branch.enemyTier;
  if (Math.random() < (OPERATOR_CHANCE[tier] || 0)) return ENEMY_CLASS.OPERATOR;
  if (Math.random() < (ELITE_CHANCE[tier] || 0)) return ENEMY_CLASS.ELITE;
  return ENEMY_CLASS.NORMAL;
}

function enterCombat(s, branch, isBoss, at) {
  const run = s.run;
  const cls = isBoss ? ENEMY_CLASS.BOSS : rollEnemyClass(branch);
  const enemy = buildEnemy(run.mapId, branch, cls);
  const stats = squadCombatStats(s);
  const interval = Math.max(
    COMBAT.minTickInterval,
    COMBAT.tickInterval / (1 + clamp(stats.fireRate, 0, 2))
  );

  // 露娜普通探测箭若提前锁定了这个真实节点，则敌人开战即带减疗标记。
  const skillStatus = run.skillRuntime?.status || {};
  if (nonNeg(skillStatus.lunaDetectedNodeIndex, -1) === nonNeg(run.nodeIndex, 0)) {
    const reduce = clamp(nonNeg(skillStatus.lunaDetectedHealReduction, 0), 0, 0.95);
    enemy.revealed = true;
    enemy.healReduction = Math.max(nonNeg(enemy.healReduction, 0), reduce);
    if (reduce > 0) pushLog('skill', `露娜的探测箭提前命中 ${enemy.name}，施加 ${Math.round(reduce * 100)}% 减疗。`);
    skillStatus.lunaDetectedNodeIndex = -1;
    skillStatus.lunaDetectedHealReduction = 0;
  }

  run.node = {
    kind: isBoss ? NODE_TYPE.BOSS : NODE_TYPE.ENEMY,
    enemyClass: cls,
    enemy,
    interval,
    lastTickAt: at
  };

  setPhase(PHASE.COMBAT, { duration: 0, at });

  let tag = '';
  if (cls === ENEMY_CLASS.BOSS) tag = '（BOSS）';
  else if (cls === ENEMY_CLASS.ELITE) tag = '（精英）';
  else if (cls === ENEMY_CLASS.OPERATOR) tag = '（敌方干员）';

  pushLog(isBoss ? 'boss' : 'enemy', `遭遇${enemy.name}${tag}，进入交战！`);
  if (enemy.skills && enemy.skills.length) {
    pushLog('enemy', `对方技能：${enemy.skills.map((k) => k.name).join('、')}`);
  }
  pushFx(isBoss ? 'boss-enter' : 'enemy-enter', { name: enemy.name, cls });
}

/** 伤害公式：防御按软上限做递减，避免出现负伤害 */
function damage(atk, def) {
  const a = nonNeg(atk, 1);
  const d = nonNeg(def, 0);
  const reduce = d / (d + COMBAT.defenseSoftCap);
  const raw = a * (1 - reduce);
  return Math.max(1, Math.round(raw * randFloat(1 - COMBAT.varianceRange, 1 + COMBAT.varianceRange)));
}

/** 穿透系数（带兜底）：敌方等级缺失时按同级处理 */
function penetrationMulSafe(ammoLevel, armorLevel) {
  const a = Number(ammoLevel) || 0;
  const d = Number(armorLevel) || 0;
  if (!a || !d) return 1;
  return penetrationMul(a, d);
}

/** 倒地干员不再参与常规枪械输出；按快照攻击占比折算当前有效火力。 */
function activeFirepowerMul(run) {
  const squad = Array.isArray(run?.squadSnapshot) ? run.squadSnapshot : [];
  const aliveIds = new Set(activeMembers(run).map((m) => m.id));
  const total = squad.reduce((sum, m) => sum + Math.max(0, nonNeg(m?.atk, 0)), 0);
  if (total <= 0) return aliveIds.size > 0 ? 1 : 0;
  const alive = squad.reduce((sum, m) => aliveIds.has(m?.id) ? sum + Math.max(0, nonNeg(m?.atk, 0)) : sum, 0);
  return clamp(alive / total, 0, 1);
}

/** 交战分次结算 */
function tickCombat(s, now) {
  const run = s.run;
  const node = run.node;
  if (!node || !node.enemy) { startMarch(s, now); return; }

  const enemy = node.enemy;
  ensureSquadMembers(run);
  syncSquadHp(run);
  const stats = squadCombatStats(s);
  const interval = Math.max(COMBAT.minTickInterval, nonNeg(node.interval, COMBAT.tickInterval));

  // 补算离线期间累积的所有结算回合，上限保护避免一次算过多
  let rounds = Math.floor((now - nonNeg(node.lastTickAt, now)) / (interval * 1000));
  if (rounds <= 0) return;
  rounds = Math.min(rounds, 240);
  node.lastTickAt = nonNeg(node.lastTickAt, now) + rounds * interval * 1000;

  for (let i = 0; i < rounds; i += 1) {
    if (enemy.hp <= 0 || squadIsWiped(run)) break;

    // 自动干员技能先于常规枪械回合结算；技能本身不消耗弹药。
    const skillEvents = tickCombatOperatorSkills(s, enemy, node.lastTickAt - (rounds - i - 1) * interval * 1000);
    if (skillEvents.length && i < 3) {
      skillEvents.forEach((ev) => {
        if (ev.type === 'heal') pushFx('heal', { amount: ev.amount });
        else if (ev.type === 'smoke') pushFx('smoke', { seconds: ev.seconds });
        else if (ev.type === 'disable') pushFx('hit-enemy', { amount: ev.amount, skill: true });
        else if (ev.type === 'skill-hit') pushFx('hit-enemy', { amount: ev.amount, skill: true });
        else if (ev.type === 'reveal') pushFx('recon', {});
        else if (ev.type === 'revive-start') pushFx('heal', { revive: true, targetId: ev.targetId });
        else if (ev.type === 'revive') pushFx('heal', { amount: ev.amount, revive: true, targetId: ev.targetId });
      });
    }
    if (enemy.hp <= 0) break;

    // 我方开火：先算穿透，再判断是否还有弹
    const shot = shotMultiplier(run.ammo, targetArmorLevel(enemy));
    if (shot.gun) {
      // 全队共用一个弹药池，每回合固定弹耗，与小队人数无关
      consumeAmmo(run.ammo, ROUNDS_PER_TICK);
      // 打空的那一刻给出提示
      if (!hasAmmo(run.ammo) && !run.ammoWarned) {
        run.ammoWarned = true;
        pushLog('fail', '弹药耗尽！枪械停火，小队只能依靠技能作战。');
        pushFx('ammo-empty', {});
      }
    }

    const evaded = nonNeg(enemy.evade, 0) > 0 && Math.random() < enemy.evade;
    let out = 0;
    if (!evaded) {
      const liveFirepower = activeFirepowerMul(run);
      out = Math.round(damage(stats.atk * liveFirepower, enemy.def) * shot.mul);
      if (enemy.isBoss) out = Math.round(out * (1 + clamp(stats.bossDmgPct, 0, 3)));
      out = Math.max(shot.gun ? 1 : 0, out);
      enemy.hp = Math.max(0, enemy.hp - out);
      run.counters.damageDealt += out;
    }
    if (i < 3) {
      if (evaded) pushFx('miss', {});
      else pushFx('hit-enemy', { amount: out, boss: enemy.isBoss, gun: shot.gun });
    }

    if (enemy.hp <= 0) break;

    // 敌方被虎蹲炮失能时，本回合无法还击。
    const roundAt = node.lastTickAt - (rounds - i - 1) * interval * 1000;
    if (enemyDisabled(enemy, roundAt)) {
      if (i < 3) pushFx('miss', { disabled: true });
      continue;
    }

    // 敌方每回合锁定一名存活干员；烟雾只对被覆盖的目标生效。
    const target = selectEnemyTarget(run);
    if (!target) break;
    const smokeEvade = memberSmokeEvade(run, target.id, roundAt);
    if (smokeEvade > 0 && Math.random() < smokeEvade) {
      if (i < 3) pushFx('miss', { smoke: true, targetId: target.id });
      continue;
    }

    // 敌方还击：敌方子弹等级对我方护甲等级同样走穿透衰减。
    const enemyPen = penetrationMulSafe(enemy.ammoLevel, run.armorLevel);
    let inc = Math.round(damage(enemy.atk, stats.def) * enemyPen);
    // 压制火力：按被命中干员自身生命上限追加伤害，避免总 HP 模型下过度放大。
    if (nonNeg(enemy.drain, 0) > 0) {
      inc += Math.round(target.maxHp * enemy.drain);
    }
    inc = Math.max(1, inc);
    const hit = applyMemberDamage(run, target, inc, roundAt);
    if (i < 3) pushFx('hit-squad', { amount: hit.damage, targetId: target.id, downed: hit.downed });

    // 敌方医疗技能：每回合治疗自身，露娜探测箭的减疗会真实压低该恢复量。
    if (enemy.hp > 0 && enemy.hp < enemy.maxHp && nonNeg(enemy.healPct, 0) > 0) {
      const reduction = clamp(nonNeg(enemy.healReduction, 0), 0, 0.95);
      const heal = Math.max(0, Math.round(enemy.maxHp * enemy.healPct * (1 - reduction)));
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + heal);
      if (heal > 0 && i < 3) pushFx('heal-enemy', { amount: heal, reduced: reduction > 0 });
    }
  }

  if (squadIsWiped(run)) {
    onSquadWiped(s);
    return;
  }

  if (enemy.hp <= 0) {
    onEnemyKilled(s, enemy, stats, now);
    return;
  }

  notify();
}

function onEnemyKilled(s, enemy, stats, now) {
  const run = s.run;
  run.counters.kills += 1;
  s.stats.kills += 1;
  if (enemy.isBoss) run.counters.bossKills += 1;
  if (enemy.cls === ENEMY_CLASS.OPERATOR) {
    run.counters.operatorKills = nonNeg(run.counters.operatorKills, 0) + 1;
  } else if (enemy.cls === ENEMY_CLASS.ELITE) {
    run.counters.eliteKills = nonNeg(run.counters.eliteKills, 0) + 1;
  }

  const loot = rollKillLoot(
    enemy.lootTier,
    {
      isBoss: !!enemy.isBoss,
      isElite: enemy.cls === ENEMY_CLASS.ELITE,
      isOperator: enemy.cls === ENEMY_CLASS.OPERATOR,
      carried: enemy.carried || []
    },
    stats.lootBonus
  );
  const gained = addToCarry(loot, s);
  s.stats.totalLoot += gained;

  // 战地自救：击杀后只恢复仍存活干员；倒地者必须通过救助/蝶大招归队。
  const regen = clamp(stats.regenPct, 0, 0.5);
  if (regen > 0) {
    let healed = 0;
    activeMembers(run).forEach((member) => {
      const amount = Math.round(member.maxHp * regen);
      const actual = Math.min(amount, Math.max(0, member.maxHp - member.hp));
      member.hp += actual;
      healed += actual;
    });
    syncSquadHp(run);
    if (healed > 0) pushFx('heal', { amount: healed });
  }

  const names = loot.map((it) => `${lootKindLabel(it)}·${it.name}${it.count > 1 ? `×${it.count}` : ''}`).join('、');
  pushLog(enemy.isBoss ? 'boss' : 'kill', `击杀${enemy.name}，缴获：${names}（+${Math.round(gained)} 价值）`);
  pushFx('enemy-die', { boss: enemy.isBoss });

  startMarch(s, now);
}

/** 小队被击溃 → 撤离失败（需求 10.9） */
let wipedHandler = null;
export function onWipe(fn) { wipedHandler = fn; }

function onSquadWiped(s) {
  const run = s.run;
  pushLog('fail', '全体干员均已倒地，小队被击溃！');
  pushFx('wipe', {});
  notify();
  if (typeof wipedHandler === 'function') wipedHandler(FAIL_REASON.WIPED);
}

/* ============ 引擎主推进 ============ */

/**
 * 单次逻辑推进；由主循环调用
 * 只处理推进 / 搜刮 / 交战，撤离与时限由 extraction 模块处理
 */
export function advance(s, now) {
  const run = s.run;
  if (!run || run.settled) return;

  switch (run.phase) {
    case PHASE.MARCH: {
      const skillEvents = tickMarchOperatorSkills(s, now);
      skillEvents.forEach((ev) => {
        if (ev.type === 'dash') pushFx('dash', { amount: ev.amount });
        else if (ev.type === 'recon') pushFx('recon', { nodes: ev.nodes });
      });
      const prog = phaseProgress(run, now);
      if (prog >= 1) {
        triggerNode(s, now);
      } else {
        notify();
      }
      break;
    }
    case PHASE.SCAVENGE: {
      if (phaseElapsed(run, now) >= nonNeg(run.phaseDuration, 0)) finishCrate(s, now);
      else notify();
      break;
    }
    case PHASE.COMBAT: {
      tickCombat(s, now);
      break;
    }
    default:
      break;
  }
}

/** 当前节点的可读描述，供演出层与面板使用 */
export function nodeLabel(run) {
  if (!run) return '';
  if (run.phase === PHASE.MARCH) return '推进中';
  if (run.phase === PHASE.SCAVENGE) return `搜刮 ${run.node?.name || '补给箱'}`;
  if (run.phase === PHASE.COMBAT) return `交战 ${run.node?.enemy?.name || '敌人'}`;
  if (run.phase === PHASE.EXTRACTING) return '撤离中';
  return '';
}

/** 行动难度文案 */
export function difficultyName(difficulty) {
  return DIFFICULTY_META[difficulty]?.name || '未知行动';
}
