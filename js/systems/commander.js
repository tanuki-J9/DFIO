/**
 * 指挥官经验账本。
 * 行动内只累计临时经验，永久经验仅在撤离结算时写入一次。
 */

import {
  COMMANDER_XP_PER_LEVEL, DIFFICULTY, commanderLevelForXp
} from '../config/index.js';
import { getState } from '../core/state.js';

const MAX_COMMANDER_XP = COMMANDER_XP_PER_LEVEL.reduce((sum, xp) => sum + xp, 0);

const DIFFICULTY_XP = Object.freeze({
  [DIFFICULTY.NORMAL]: 100,
  [DIFFICULTY.SECRET]: 250,
  [DIFFICULTY.TOP_SECRET]: 600,
  [DIFFICULTY.ETERNAL]: 1200
});

function nonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return n === Number.POSITIVE_INFINITY ? MAX_COMMANDER_XP : 0;
  return Math.max(0, Math.floor(n));
}

function cappedTotalXp(value) {
  return Math.min(MAX_COMMANDER_XP, nonNegativeInt(value));
}

function currentLevelXp(totalXp, level) {
  if (level >= 30) return 0;
  const spent = COMMANDER_XP_PER_LEVEL.slice(0, level - 1)
    .reduce((sum, xp) => sum + xp, 0);
  return totalXp - spent;
}

function zeroResult(s) {
  const totalXp = cappedTotalXp(s?.commander?.totalXp);
  const level = commanderLevelForXp(totalXp);
  return { earned: 0, applied: 0, beforeLevel: level, afterLevel: level, totalXp };
}

/** Add already-calculated kill or loot XP to the active run. */
export function addRunXp(kind, amount, s = getState()) {
  const run = s?.run;
  if (!run || run.settled || run.commanderXpSettled) return 0;

  const earned = nonNegativeInt(amount);
  if (earned <= 0) return 0;
  run.commanderXp = nonNegativeInt(run.commanderXp) + earned;
  return earned;
}

/** Preview the permanent XP result without mutating state. */
export function previewSettlementXp(success, s = getState()) {
  const run = s?.run;
  if (!run || run.commanderXpSettled) return zeroResult(s);

  const beforeTotal = cappedTotalXp(s?.commander?.totalXp);
  const beforeLevel = commanderLevelForXp(beforeTotal);
  const runXp = nonNegativeInt(run.commanderXp);
  const earned = success
    ? runXp + nonNegativeInt(DIFFICULTY_XP[run.difficulty])
    : Math.floor(runXp * 0.3);
  const totalXp = Math.min(MAX_COMMANDER_XP, beforeTotal + earned);
  const afterLevel = commanderLevelForXp(totalXp);

  return {
    earned,
    applied: totalXp - beforeTotal,
    beforeLevel,
    afterLevel,
    totalXp
  };
}

/** Commit the active run's XP exactly once. */
export function settleCommanderXp(success, s = getState()) {
  const run = s?.run;
  if (!run || run.commanderXpSettled) return zeroResult(s);

  const result = previewSettlementXp(success, s);
  run.commanderXpSettled = true;

  const level = result.afterLevel;
  s.commander = {
    level,
    totalXp: result.totalXp,
    currentXp: currentLevelXp(result.totalXp, level)
  };
  return result;
}
