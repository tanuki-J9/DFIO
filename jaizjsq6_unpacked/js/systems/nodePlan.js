/**
 * 节点预排队列。
 * 侦察技能读取这里的“真实未来节点”，推进时也从同一队列消费，
 * 因此探测结果不会与随后实际遭遇脱节。
 */

import { weightedPick } from '../core/utils.js';

export function ensureNodeQueue(run, branch, count = 1) {
  if (!run || !branch) return [];
  if (!Array.isArray(run.nodeQueue)) run.nodeQueue = [];
  const need = Math.max(0, Math.floor(count));
  while (run.nodeQueue.length < need) {
    run.nodeQueue.push(weightedPick(branch.weights) || 'crate');
  }
  return run.nodeQueue;
}

export function peekNodeQueue(run, branch, count = 1) {
  ensureNodeQueue(run, branch, count);
  return run.nodeQueue.slice(0, Math.max(0, Math.floor(count)));
}

export function takeNextNode(run, branch) {
  ensureNodeQueue(run, branch, 1);
  return run.nodeQueue.shift() || 'crate';
}
