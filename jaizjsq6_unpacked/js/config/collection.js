/**
 * 收藏品与收藏室图鉴配置
 *
 * 收藏品（COLLECTIBLE_TEMPLATES）：仓库「收藏品」分类下的物资，只有价值没有属性。
 *   金色（legend）与红色（red）物资归入收藏品；其中红色即俗称的「大红」，
 *   获得后会登记进收藏室图鉴。
 * 图鉴（GALLERY_SERIES）：收藏室按系列分组展示的图鉴条目，记录玩家是否曾经获得过。
 */

import { RARITY } from './equipment.js';

/** 收藏品分类 */
export const COLLECT_KIND = {
  ARTIFACT: 'artifact',
  INTEL: 'intel',
  MEDAL: 'medal',
  ANOMALY: 'anomaly',
  TECH: 'tech'
};

export const COLLECT_KIND_META = {
  [COLLECT_KIND.ARTIFACT]: { id: COLLECT_KIND.ARTIFACT, name: '古物', icon: '🏺' },
  [COLLECT_KIND.INTEL]: { id: COLLECT_KIND.INTEL, name: '情报', icon: '🗂️' },
  [COLLECT_KIND.MEDAL]: { id: COLLECT_KIND.MEDAL, name: '勋章', icon: '🎗️' },
  [COLLECT_KIND.ANOMALY]: { id: COLLECT_KIND.ANOMALY, name: '异常物', icon: '☢️' },
  [COLLECT_KIND.TECH]: { id: COLLECT_KIND.TECH, name: '器械', icon: '🔧' }
};

/**
 * 收藏品模板
 * value 为出售价值，不计入战备
 */
export const COLLECTIBLE_TEMPLATES = [
  // 金色 12 件
  { id: 'c_coffee', name: '盒装挂耳咖啡', kind: COLLECT_KIND.ARTIFACT, rarity: RARITY.LEGEND, value: 1800, desc: '战前产的挂耳包，前线换物时比现金好用。' },
  { id: 'c_radio', name: '大型电台', kind: COLLECT_KIND.TECH, rarity: RARITY.LEGEND, value: 2600, desc: '整机搬运困难，但收购价一直居高不下。' },
  { id: 'c_lens', name: '镜头', kind: COLLECT_KIND.TECH, rarity: RARITY.LEGEND, value: 2200, desc: '军用级光学镜片，镀膜完好无划痕。' },
  { id: 'c_cable', name: '移动电缆', kind: COLLECT_KIND.TECH, rarity: RARITY.LEGEND, value: 1900, desc: '成卷的重载电缆，工程队抢着要。' },
  { id: 'c_server', name: '阵列服务器', kind: COLLECT_KIND.TECH, rarity: RARITY.LEGEND, value: 3400, desc: '硬盘位全满，数据尚未被擦除。' },
  { id: 'c_haf_file', name: '哈夫克机密档案', kind: COLLECT_KIND.INTEL, rarity: RARITY.LEGEND, value: 3800, desc: '封条完整，页脚盖着哈夫克内部编号。' },
  { id: 'c_asara_file', name: '阿萨拉卫队机密档案', kind: COLLECT_KIND.INTEL, rarity: RARITY.LEGEND, value: 3600, desc: '记录了卫队换防的全部时间表。' },
  { id: 'c_crossbow', name: '赛伊德的手弩', kind: COLLECT_KIND.ARTIFACT, rarity: RARITY.LEGEND, value: 4200, desc: '弩臂上刻着主人的名字，保养得很好。' },
  { id: 'c_judgement', name: '格赫罗斯的审判', kind: COLLECT_KIND.ARTIFACT, rarity: RARITY.LEGEND, value: 4600, desc: '仪式用的长刃，据说从未见血。' },
  { id: 'c_pass', name: '军事通行证', kind: COLLECT_KIND.INTEL, rarity: RARITY.LEGEND, value: 2800, desc: '有效期已过，但编号仍能通过外围岗哨。' },
  { id: 'c_fuel_rod', name: '微型燃料棒', kind: COLLECT_KIND.ANOMALY, rarity: RARITY.LEGEND, value: 3200, desc: '铅罐封装，靠近时剂量计会轻微跳动。' },
  { id: 'c_gazelle', name: '黄金瞪羚', kind: COLLECT_KIND.ARTIFACT, rarity: RARITY.LEGEND, value: 4800, desc: '实心铸造的摆件，底座有拍卖行钢印。' },

  // 红色 8 件（大红）
  { id: 'c_africa_heart', name: '非洲之心', kind: COLLECT_KIND.ARTIFACT, rarity: RARITY.RED, value: 12000, desc: '切工完美的巨钻，黑市上只有传闻没有实物。' },
  { id: 'c_ocean_tear', name: '海洋之泪', kind: COLLECT_KIND.ARTIFACT, rarity: RARITY.RED, value: 11500, desc: '深蓝宝石，据说沉过一整艘运输船。' },
  { id: 'c_gpu', name: '显卡', kind: COLLECT_KIND.TECH, rarity: RARITY.RED, value: 9800, desc: '战前旗舰型号，如今一张能换一套配装。' },
  { id: 'c_exp_data', name: '实验数据', kind: COLLECT_KIND.INTEL, rarity: RARITY.RED, value: 10500, desc: '完整未删减的原始记录，买家不止一方。' },
  { id: 'c_reactor_core', name: '反应堆冷却核心', kind: COLLECT_KIND.ANOMALY, rarity: RARITY.RED, value: 13500, desc: '表面凝着永不融化的白霜。' },
  { id: 'c_bee_medic', name: '炫彩蜂小医', kind: COLLECT_KIND.ARTIFACT, rarity: RARITY.RED, value: 9200, desc: '限量涂装的医疗机器人玩偶，收藏圈的硬通货。' },
  { id: 'c_blue_plate', name: '青花瑞兽纹盘', kind: COLLECT_KIND.ARTIFACT, rarity: RARITY.RED, value: 12800, desc: '釉面无冲无裂，纹样为罕见瑞兽题材。' },
  { id: 'c_blue_censer', name: '青花双耳三足炉', kind: COLLECT_KIND.ARTIFACT, rarity: RARITY.RED, value: 14000, desc: '三足俱全，炉内还留着旧香灰。' }
];

export function getCollectible(id) {
  return COLLECTIBLE_TEMPLATES.find((c) => c.id === id) || null;
}

/** 全部「大红」（红色）收藏品 */
export function legendCollectibles() {
  return COLLECTIBLE_TEMPLATES.filter((c) => c.rarity === RARITY.RED);
}

/**
 * 收藏室图鉴系列
 * entries 为该系列下的图鉴条目 id，可指向收藏品或装备模板
 * refType: 'collectible' | 'equipment'
 */
export const GALLERY_SERIES = [
  {
    id: 'g_red',
    name: '大红典藏',
    icon: '🔺',
    desc: '全服公示的红色物资，撤离成功才算真正到手。',
    refType: 'collectible',
    entries: [
      'c_africa_heart', 'c_ocean_tear', 'c_gpu', 'c_exp_data',
      'c_reactor_core', 'c_bee_medic', 'c_blue_plate', 'c_blue_censer'
    ]
  },
  {
    id: 'g_relic',
    name: '战区遗物',
    icon: '🏺',
    desc: '各战区流出的金色遗物与仪式器物。',
    refType: 'collectible',
    entries: ['c_crossbow', 'c_judgement', 'c_gazelle', 'c_coffee']
  },
  {
    id: 'g_intel',
    name: '机密情报',
    icon: '🗂️',
    desc: '来自封存档案与数据载体的碎片，拼起来是另一个故事。',
    refType: 'collectible',
    entries: ['c_haf_file', 'c_asara_file', 'c_pass', 'c_server']
  },
  {
    id: 'g_gear',
    name: '顶级装备',
    icon: '🔫',
    desc: '传说与绝密品质的武器防具，收录后可在此回顾属性。',
    refType: 'equipment',
    entries: ['w_rail', 'w_mg', 'a_t6', 'h_t6', 'b_x', 't_air']
  }
];

export function getGallerySeries(id) {
  return GALLERY_SERIES.find((g) => g.id === id) || null;
}

/** 图鉴条目总数（用于收录进度） */
export function galleryTotal() {
  return GALLERY_SERIES.reduce((sum, g) => sum + g.entries.length, 0);
}
