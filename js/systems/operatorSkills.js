/**
 * 干员定位被动与自动技能运行时。
 *
 * 生命系统以 run.members 为真实来源，run.hp / run.maxHp 仅保留为汇总兼容字段。
 * 技能 CD 与读条全部使用绝对时间戳，切后台或刷新后不会重新计时。
 */

import { OPERATOR_SKILL_EFFECTS, ROLE, ROLE_PASSIVE_EFFECTS, getBranch, getTemplate } from '../config/index.js';
import { getOperator } from '../config/operators.js';
import { pushLog } from '../core/state.js';
import { nonNeg, clamp } from '../core/utils.js';
import { peekNodeQueue } from './nodePlan.js';

const BASE_RESCUE_SECONDS = 8;
const BASE_RESCUE_HP_PCT = 0.25;
const ULT_REVIVE_HP_PCT = 0.40;
const MEDICAL_TRIGGER_RATIO = nonNeg(getTemplate('t_med')?.healing?.triggerRatio, 0.5);

function runtime(run) {
  if (!run.skillRuntime || typeof run.skillRuntime !== 'object') {
    run.skillRuntime = { cooldowns: {}, status: {}, casts: 0 };
  }
  if (!run.skillRuntime.cooldowns) run.skillRuntime.cooldowns = {};
  if (!run.skillRuntime.status) run.skillRuntime.status = {};
  return run.skillRuntime;
}

/** 旧行动存档兜底：按总生命比例临时补出逐干员生命。 */
export function ensureSquadMembers(run) {
  if (!run) return [];
  if (Array.isArray(run.members) && run.members.length) return run.members;
  const squad = Array.isArray(run.squadSnapshot) ? run.squadSnapshot.filter(Boolean) : [];
  if (!squad.length) {
    run.members = [];
    return run.members;
  }
  const weights = squad.map((m) => Math.max(1, nonNeg(m?.hp, 1)));
  const weightSum = weights.reduce((a, b) => a + b, 0) || squad.length;
  const teamMax = Math.max(squad.length, nonNeg(run.maxHp, squad.length));
  const teamRatio = clamp(nonNeg(run.hp, teamMax) / teamMax, 0, 1);
  let assigned = 0;
  run.members = squad.map((m, i) => {
    const maxHp = i === squad.length - 1
      ? Math.max(1, Math.round(teamMax - assigned))
      : Math.max(1, Math.round(teamMax * weights[i] / weightSum));
    assigned += maxHp;
    const hp = Math.round(maxHp * teamRatio);
    return {
      id: String(m.id || `member_${i}`),
      name: String(m.name || m.id || `干员 ${i + 1}`),
      role: String(m.role || 'assault'),
      maxHp,
      hp,
      downed: hp <= 0,
      downedAt: hp <= 0 ? Date.now() : 0,
      revived: 0
    };
  });
  syncSquadHp(run);
  return run.members;
}

export function syncSquadHp(run) {
  const members = Array.isArray(run?.members) ? run.members : [];
  if (!members.length) return;
  run.maxHp = members.reduce((sum, m) => sum + Math.max(1, nonNeg(m.maxHp, 1)), 0);
  run.hp = members.reduce((sum, m) => sum + Math.max(0, nonNeg(m.hp, 0)), 0);
}

export function activeMembers(run) {
  return ensureSquadMembers(run).filter((m) => !m.downed && nonNeg(m.hp, 0) > 0);
}

export function downedMembers(run) {
  return ensureSquadMembers(run).filter((m) => m.downed || nonNeg(m.hp, 0) <= 0);
}

export function squadIsWiped(run) {
  const all = ensureSquadMembers(run);
  return all.length > 0 && activeMembers(run).length === 0;
}

function memberById(run, id) {
  return ensureSquadMembers(run).find((m) => m.id === id) || null;
}

function squadHas(run, opId) {
  return ensureSquadMembers(run).some((op) => op?.id === opId);
}

function operatorAlive(run, opId) {
  const m = memberById(run, opId);
  return !!m && !m.downed && m.hp > 0;
}

function operatorAtk(run, opId) {
  const op = run?.squadSnapshot?.find((x) => x?.id === opId);
  return Math.max(1, nonNeg(op?.atk, 1));
}

function ready(run, skill, now) {
  const rt = runtime(run);
  return now >= nonNeg(rt.cooldowns[skill.id], 0);
}

function commit(run, skill, now) {
  const rt = runtime(run);
  rt.cooldowns[skill.id] = now + nonNeg(skill.cooldown, 0) * 1000;
  rt.casts = nonNeg(rt.casts, 0) + 1;
}

function skillDamage(run, opId, skill) {
  return Math.max(1, Math.round(operatorAtk(run, opId) * nonNeg(skill.atkMul, 1)));
}

function hitEnemy(run, enemy, amount) {
  const dmg = Math.max(0, Math.round(nonNeg(amount, 0)));
  if (!enemy || dmg <= 0) return 0;
  enemy.hp = Math.max(0, nonNeg(enemy.hp, 0) - dmg);
  run.counters.damageDealt = nonNeg(run.counters.damageDealt, 0) + dmg;
  return dmg;
}

function hpRatio(member) {
  return member?.maxHp > 0 ? nonNeg(member.hp, 0) / member.maxHp : 0;
}

function lowestAlive(run, count = 1, { excludeId = null } = {}) {
  return activeMembers(run)
    .filter((m) => !excludeId || m.id !== excludeId)
    .sort((a, b) => hpRatio(a) - hpRatio(b))
    .slice(0, Math.max(0, count));
}

/**
 * Automatically use one snapshotted medical tactical charge for this combat tick.
 * Downed members are excluded so tactical medicine never acts as a revive.
 */
export function tryAutoMedical(run, now = Date.now()) {
  const medical = run?.medical;
  if (!medical || nonNeg(medical.remainingUses, 0) <= 0 || nonNeg(medical.healRatio, 0) <= 0) {
    return { used: false };
  }

  const tickAt = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const status = runtime(run).status;
  if (status.medicalUsedAt === tickAt) return { used: false };

  const target = lowestAlive(run, 1)
    .find((member) => hpRatio(member) < MEDICAL_TRIGGER_RATIO);
  if (!target) return { used: false };

  const amount = healMember(run, target, target.maxHp * nonNeg(medical.healRatio, 0));
  if (amount <= 0) return { used: false };

  medical.remainingUses = Math.max(0, Math.floor(nonNeg(medical.remainingUses, 0)) - 1);
  status.medicalUsedAt = tickAt;
  return { used: true, targetId: target.id, amount };
}

/**
 * 敌方攻击前选定一个真实干员目标。烟雾只保护被覆盖的那个人。
 */
export function selectEnemyTarget(run) {
  const alive = activeMembers(run);
  if (!alive.length) return null;
  return alive[Math.floor(Math.random() * alive.length)] || alive[0];
}

export function memberSmokeEvade(run, memberId, now) {
  const rt = runtime(run);
  if (nonNeg(rt.status.smokeUntil, 0) <= now) return 0;
  if (rt.status.smokeTargetId !== memberId) return 0;
  return clamp(rt.status.smokeEvade, 0, 0.85);
}

/** 对指定干员造成伤害，并负责把 0 HP 转为倒地。 */
export function applyMemberDamage(run, member, amount, now = Date.now()) {
  if (!run || !member || member.downed || member.hp <= 0) return { damage: 0, downed: false, member };
  const damage = Math.max(0, Math.round(nonNeg(amount, 0)));
  if (!damage) return { damage: 0, downed: false, member };
  const actual = Math.min(member.hp, damage);
  member.hp = Math.max(0, member.hp - damage);
  let justDowned = false;
  if (member.hp <= 0) {
    member.hp = 0;
    member.downed = true;
    member.downedAt = now;
    justDowned = true;
    pushLog('fail', `${member.name} 倒地！`);
  }
  run.counters.damageTaken = nonNeg(run.counters.damageTaken, 0) + actual;
  syncSquadHp(run);
  return { damage: actual, downed: justDowned, member };
}

function healMember(run, member, amount) {
  if (!member || member.downed || member.hp <= 0) return 0;
  const missing = Math.max(0, member.maxHp - member.hp);
  const actual = Math.min(missing, Math.max(0, Math.round(amount)));
  member.hp += actual;
  syncSquadHp(run);
  return actual;
}

function reviveMember(run, member, hpPct, label) {
  if (!member || !member.downed) return 0;
  const hp = Math.max(1, Math.round(member.maxHp * clamp(hpPct, 0.05, 1)));
  member.downed = false;
  member.hp = hp;
  member.downedAt = 0;
  member.revived = nonNeg(member.revived, 0) + 1;
  syncSquadHp(run);
  pushLog('skill', `${label}，${member.name} 以 ${hp} 点生命重新归队。`);
  return hp;
}

function supportReviveSpeed(run) {
  const supportCount = activeMembers(run).filter((m) => m.role === ROLE.SUPPORT).length;
  return supportCount * nonNeg(ROLE_PASSIVE_EFFECTS[ROLE.SUPPORT]?.reviveSpeed, 0)
    + nonNeg(run?.baseBonuses?.medicalReviveSpeed, 0);
}

/**
 * 自动救助/蝶大招读条。
 * 蝶存活且大招可用时优先使用大招；否则由存活队员执行普通救助。
 */
function tickRevive(run, now, events) {
  const rt = runtime(run);
  const status = rt.status;
  const fallen = downedMembers(run);
  if (!fallen.length) {
    status.reviveChannel = null;
    return;
  }

  let channel = status.reviveChannel;
  if (channel) {
    const target = memberById(run, channel.targetId);
    const source = memberById(run, channel.sourceId);
    if (!target?.downed || !source || source.downed || source.hp <= 0) {
      if (target?.downed && source?.downed) pushLog('fail', `${channel.label || '救助'}读条因施救者倒地而中断。`);
      status.reviveChannel = null;
      channel = null;
    } else if (now >= nonNeg(channel.endsAt, now + 1)) {
      const hp = reviveMember(run, target, channel.hpPct, channel.label || '救助完成');
      events.push({ type: 'revive', amount: hp, targetId: target.id, opId: source.id, ultimate: channel.kind === 'ultimate' });
      status.reviveChannel = null;
      return;
    }
  }
  if (channel) return;

  const target = fallen.sort((a, b) => nonNeg(a.downedAt, 0) - nonNeg(b.downedAt, 0))[0];
  if (!target) return;

  // 蝶大招：队友倒地时自动触发；蝶自己倒地时不能自救。
  if (operatorAlive(run, 'op_die')) {
    const ult = OPERATOR_SKILL_EFFECTS.op_die.revive;
    if (target.id !== 'op_die' && ready(run, ult, now)) {
      commit(run, ult, now);
      status.reviveChannel = {
        kind: 'ultimate', sourceId: 'op_die', targetId: target.id,
        startedAt: now, endsAt: now + ult.channelSeconds * 1000,
        duration: ult.channelSeconds, hpPct: ULT_REVIVE_HP_PCT,
        label: `蝶的【${ult.name}】读条完成`
      };
      pushLog('skill', `蝶释放【${ult.name}】，开始救助 ${target.name}（${ult.channelSeconds.toFixed(1)} 秒）。`);
      events.push({ type: 'revive-start', targetId: target.id, opId: 'op_die', seconds: ult.channelSeconds, ultimate: true });
      return;
    }
  }

  const rescuers = activeMembers(run);
  if (!rescuers.length) return;
  // 普通救助优先由支援位执行；支援定位被动会缩短整队救助读条。
  const source = rescuers.find((m) => m.role === ROLE.SUPPORT) || rescuers[0];
  const speed = clamp(supportReviveSpeed(run), 0, 2);
  const duration = BASE_RESCUE_SECONDS / (1 + speed);
  status.reviveChannel = {
    kind: 'normal', sourceId: source.id, targetId: target.id,
    startedAt: now, endsAt: now + duration * 1000,
    duration, hpPct: BASE_RESCUE_HP_PCT,
    label: '战地救助完成'
  };
  pushLog('skill', `${source.name} 开始救助 ${target.name}（${duration.toFixed(1)} 秒${speed > 0 ? '，救助加速' : ''}）。`);
  events.push({ type: 'revive-start', targetId: target.id, opId: source.id, seconds: duration, ultimate: false });
}

/** 推进阶段自动技能。返回用于演出的事件列表。 */
export function tickMarchOperatorSkills(s, now) {
  const run = s?.run;
  if (!run) return [];
  ensureSquadMembers(run);
  const events = [];

  if (operatorAlive(run, 'op_weilong')) {
    const sk = OPERATOR_SKILL_EFFECTS.op_weilong.jetpack;
    if (ready(run, sk, now)) {
      const remainingMs = Math.max(0, (run.phaseStartedAt + run.phaseDuration * 1000) - now);
      if (remainingMs > 450) {
        const marchTiming = runtime(run).status.marchTiming;
        // Legacy active marches have no timing snapshot; they keep their
        // current duration for this one phase so an old save cannot bypass
        // the new global cap/floor. The skill still triggers normally.
        const minimumDuration = clamp(
          nonNeg(marchTiming?.minimumDuration, run.phaseDuration),
          0,
          nonNeg(run.phaseDuration, 0)
        );
        const totalCutBudgetMs = Math.max(
          0,
          Math.round((nonNeg(run.phaseDuration, 0) - minimumDuration) * 1000)
        );
        const appliedCutMs = Math.min(
          totalCutBudgetMs,
          nonNeg(marchTiming?.activeCutMs, 0)
        );
        const cutMs = Math.min(
          remainingMs - 250,
          sk.skipSeconds * 1000,
          totalCutBudgetMs - appliedCutMs
        );
        run.phaseStartedAt -= Math.max(0, cutMs);
        if (marchTiming) marchTiming.activeCutMs = appliedCutMs + Math.max(0, cutMs);
        run.distance = nonNeg(run.distance, 0) + nonNeg(sk.distance, 0);
        commit(run, sk, now);
        pushLog('skill', `威龙释放【${sk.name}】，小队突进 ${Math.round(sk.distance)}m。`);
        events.push({ type: 'dash', amount: sk.distance, opId: 'op_weilong' });
      }
    }
  }

  if (operatorAlive(run, 'op_luna')) {
    const branch = getBranch(run.mapId, run.difficulty);
    const detect = OPERATOR_SKILL_EFFECTS.op_luna.detect_arrow;
    if (branch && ready(run, detect, now)) {
      const preview = peekNodeQueue(run, branch, Math.max(1, nonNeg(detect.revealNodes, 1)));
      const hostile = preview.some((kind) => kind === 'enemy' || kind === 'boss');
      commit(run, detect, now);
      if (hostile) {
        const rt = runtime(run);
        rt.status.lunaDetectedNodeIndex = nonNeg(run.nodeIndex, 0) + 1;
        rt.status.lunaDetectedHealReduction = nonNeg(detect.healReduction, 0);
        pushLog('skill', `露娜释放【${detect.name}】，提前探测到前方存在敌人，并锁定减疗标记。`);
      } else {
        pushLog('skill', `露娜释放【${detect.name}】，中距离扫描未发现敌人。`);
      }
      events.push({ type: 'recon', nodes: detect.revealNodes, hostile, opId: 'op_luna', close: true });
    }

    const sk = OPERATOR_SKILL_EFFECTS.op_luna.long_detect;
    if (branch && ready(run, sk, now)) {
      const preview = peekNodeQueue(run, branch, Math.max(1, nonNeg(sk.revealNodes, 1)));
      const enemies = preview.filter((kind) => kind === 'enemy' || kind === 'boss').length;
      const bosses = preview.filter((kind) => kind === 'boss').length;
      commit(run, sk, now);
      runtime(run).status.lunaReconUntilNode = nonNeg(run.nodeIndex, 0) + nonNeg(sk.revealNodes, 0);
      pushLog('skill', `露娜释放【${sk.name}】，极远侦察确认前方 ${sk.revealNodes} 个节点中有 ${enemies} 处敌情${bosses ? `，其中 ${bosses} 处高威胁信号` : ''}。`);
      events.push({ type: 'recon', nodes: sk.revealNodes, enemies, bosses, opId: 'op_luna' });
    }
  }

  return events;
}

/** 交战阶段自动技能。 */
export function tickCombatOperatorSkills(s, enemy, now) {
  const run = s?.run;
  if (!run || !enemy || enemy.hp <= 0) return [];
  ensureSquadMembers(run);
  const events = [];

  // 倒地/复活优先于本回合其它技能。
  tickRevive(run, now, events);

  // 露娜：探测箭 + 手榴弹
  if (operatorAlive(run, 'op_luna')) {
    const grenade = OPERATOR_SKILL_EFFECTS.op_luna.grenade;
    if (enemy.hp > 0 && ready(run, grenade, now)) {
      commit(run, grenade, now);
      const dealt = hitEnemy(run, enemy, skillDamage(run, 'op_luna', grenade));
      pushLog('skill', `露娜投掷【${grenade.name}】，造成 ${dealt} 点范围伤害。`);
      events.push({ type: 'skill-hit', amount: dealt, opId: 'op_luna' });
    }
  }

  // 威龙：C4 + 虎蹲炮
  if (enemy.hp > 0 && operatorAlive(run, 'op_weilong')) {
    const c4 = OPERATOR_SKILL_EFFECTS.op_weilong.c4;
    if (ready(run, c4, now)) {
      commit(run, c4, now);
      const dealt = hitEnemy(run, enemy, skillDamage(run, 'op_weilong', c4));
      pushLog('skill', `威龙引爆【${c4.name}】，造成 ${dealt} 点范围伤害。`);
      events.push({ type: 'skill-hit', amount: dealt, opId: 'op_weilong' });
    }

    const ult = OPERATOR_SKILL_EFFECTS.op_weilong.tiger_mortar;
    if (enemy.hp > 0 && ready(run, ult, now)) {
      commit(run, ult, now);
      const dealt = hitEnemy(run, enemy, skillDamage(run, 'op_weilong', ult));
      enemy.disabledUntil = Math.max(nonNeg(enemy.disabledUntil, 0), now + ult.disableSeconds * 1000);
      pushLog('skill', `威龙发射【${ult.name}】，造成 ${dealt} 点伤害并使敌方失能 ${ult.disableSeconds} 秒。`);
      events.push({ type: 'disable', amount: dealt, seconds: ult.disableSeconds, opId: 'op_weilong' });
    }
  }

  // 蝶：烟雾覆盖 1 人；回血装置治疗生命比例最低的 2 名存活干员。
  if (enemy.hp > 0 && operatorAlive(run, 'op_die')) {
    const smoke = OPERATOR_SKILL_EFFECTS.op_die.smoke;
    const smokeTarget = lowestAlive(run, 1, { excludeId: 'op_die' })[0] || null;
    if (smokeTarget && ready(run, smoke, now)) {
      commit(run, smoke, now);
      const rt = runtime(run);
      rt.status.smokeUntil = now + smoke.duration * 1000;
      rt.status.smokeEvade = clamp(smoke.evadeChance, 0, 0.85);
      rt.status.smokeTargetId = smokeTarget.id;
      pushLog('skill', `蝶释放【${smoke.name}】，烟雾覆盖 ${smokeTarget.name}，持续 ${smoke.duration} 秒。`);
      events.push({ type: 'smoke', seconds: smoke.duration, targetId: smokeTarget.id, opId: 'op_die' });
    }

    const heal = OPERATOR_SKILL_EFFECTS.op_die.heal_device;
    const healTargets = lowestAlive(run, 2).filter((m) => hpRatio(m) < 0.92);
    if (healTargets.length && ready(run, heal, now)) {
      commit(run, heal, now);
      let total = 0;
      const healed = [];
      healTargets.forEach((target) => {
        const amount = Math.max(1, Math.round(target.maxHp * heal.healPct));
        const actual = healMember(run, target, amount);
        if (actual > 0) {
          total += actual;
          healed.push(`${target.name}+${actual}`);
        }
      });
      if (total > 0) {
        pushLog('skill', `蝶部署【${heal.name}】，治疗 ${healed.join('、')}。`);
        events.push({ type: 'heal', amount: total, targets: healTargets.map((m) => m.id), opId: 'op_die' });
      }
    }
  }

  return events;
}

/** 敌方本回合是否因虎蹲炮失能而无法还击。 */
export function enemyDisabled(enemy, now) {
  return nonNeg(enemy?.disabledUntil, 0) > now;
}

/** 兼容旧调用：返回当前烟雾的单体闪避率（新战斗应调用 memberSmokeEvade）。 */
export function squadSmokeEvade(run, now) {
  const rt = runtime(run);
  if (nonNeg(rt.status.smokeUntil, 0) <= now) return 0;
  return clamp(rt.status.smokeEvade, 0, 0.85);
}

/** 当前正在进行的救助读条，供 UI 展示。 */
export function reviveRuntimeView(run, now = Date.now()) {
  if (!run) return null;
  const channel = runtime(run).status.reviveChannel;
  if (!channel) return null;
  const target = memberById(run, channel.targetId);
  const source = memberById(run, channel.sourceId);
  const duration = Math.max(0.01, nonNeg(channel.duration, 0.01));
  const elapsed = Math.max(0, (now - nonNeg(channel.startedAt, now)) / 1000);
  return {
    ...channel,
    targetName: target?.name || channel.targetId,
    sourceName: source?.name || channel.sourceId,
    remaining: Math.max(0, (nonNeg(channel.endsAt, now) - now) / 1000),
    progress: clamp(elapsed / duration, 0, 1)
  };
}

/** 供 UI/调试查看技能冷却。 */
export function skillRuntimeView(run, now = Date.now()) {
  if (!run) return [];
  const rt = runtime(run);
  const out = [];
  (run.squadSnapshot || []).forEach((member) => {
    const cfg = getOperator(member.id);
    const effectSet = OPERATOR_SKILL_EFFECTS[member.id];
    if (!cfg || !effectSet) return;
    Object.values(effectSet).forEach((sk) => {
      out.push({
        opId: member.id,
        operator: cfg.name,
        id: sk.id,
        name: sk.name,
        slot: sk.slot,
        remaining: Math.max(0, (nonNeg(rt.cooldowns[sk.id], 0) - now) / 1000),
        pending: sk.phase === 'downed'
      });
    });
  });
  return out;
}
