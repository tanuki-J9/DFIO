/**
 * 干员定位被动与专属技能数值。
 * 这里只放数值与触发条件，实际执行逻辑位于 systems/operatorSkills.js。
 */

export const ROLE_PASSIVE_EFFECTS = {
  scout: {
    /** 提升高档补给箱权重，按上阵侦察干员数量叠加 */
    crateTierBonus: 0.14
  },
  assault: {
    /** 推进耗时缩短比例，按上阵突击干员数量叠加 */
    marchSpeed: 0.12
  },
  support: {
    /** 倒地救助速度加成，支援位存活时生效 */
    reviveSpeed: 0.25
  },
  engineer: {}
};

export const OPERATOR_SKILL_EFFECTS = {
  op_luna: {
    detect_arrow: {
      id: 'luna_detect_arrow',
      name: '探测箭',
      slot: 'normal1',
      cooldown: 18,
      phase: 'march',
      /** 中距离：预判下一个真实节点；若命中敌情，则该敌人进入交战时自带减疗 */
      revealNodes: 1,
      healReduction: 0.45
    },
    grenade: {
      id: 'luna_grenade',
      name: '手榴弹',
      slot: 'normal2',
      cooldown: 14,
      phase: 'combat',
      /** 以露娜攻击力为基准的技能倍率 */
      atkMul: 1.35
    },
    long_detect: {
      id: 'luna_long_detect',
      name: '远程探测箭',
      slot: 'ultimate',
      cooldown: 55,
      phase: 'march',
      /** 预警持续的推进节点数；真正节点预生成后可升级为精确信息 */
      revealNodes: 3
    }
  },

  op_weilong: {
    c4: {
      id: 'weilong_c4',
      name: 'C4 炸药',
      slot: 'normal1',
      cooldown: 16,
      phase: 'combat',
      atkMul: 1.65
    },
    jetpack: {
      id: 'weilong_jetpack',
      name: '喷气背包',
      slot: 'normal2',
      cooldown: 22,
      phase: 'march',
      /** 瞬间削减当前推进阶段剩余时间 */
      skipSeconds: 1.8,
      /** 演出/统计用的额外位移 */
      distance: 120
    },
    tiger_mortar: {
      id: 'weilong_tiger_mortar',
      name: '虎蹲炮',
      slot: 'ultimate',
      cooldown: 58,
      phase: 'combat',
      /** 失能时间 */
      disableSeconds: 2,
      atkMul: 0.75
    }
  },

  op_die: {
    smoke: {
      id: 'die_smoke',
      name: '掩护烟雾',
      slot: 'normal1',
      cooldown: 17,
      phase: 'combat',
      duration: 6,
      /** 单目标烟雾闪避概率 */
      evadeChance: 0.28
    },
    heal_device: {
      id: 'die_heal_device',
      name: '回血装置',
      slot: 'normal2',
      cooldown: 20,
      phase: 'combat',
      /** 对每个治疗目标按其自身最大生命比例恢复 */
      healPct: 0.12
    },
    revive: {
      id: 'die_revive',
      name: '归队协议',
      slot: 'ultimate',
      cooldown: 75,
      phase: 'downed',
      /** 队友倒地时自动触发的复活读条 */
      channelSeconds: 4.5
    }
  }
};
