export const categories = {
  village: ['行政村', '个'],
  building: ['建筑', '栋'],
  hospital: ['医院', '院区'],
  school: ['小学', '校区'],
  'state-land': ['国有用地', 'ha'],
  'collective-land': ['集体用地', 'ha'],
};

export const topics = {
  overview: Object.keys(categories),
  buildings: ['village', 'building'],
  services: ['hospital', 'school'],
  land: ['state-land', 'collective-land'],
};

export const towns = {
  石碶街道: '上王 石碶 黄隘 车何渡 汪家 塘西 东杨 西杨 横涨 联丰 雅渡 星光 栎社 冯家 后仓',
  古林镇: '包家 宋严王 礼嘉桥 仲一 三星 布政 鹅颈 薛家 西洋港 前虞 龙三 藕池 张家潭 俞家 郭夏 古林 陈横楼 蜃蛟 共任 葑水港 茂新 施家 葑里',
};

export const colors = ['#ba9429', '#d88929', '#db683a', '#bd4340', '#9e294a'];
export const objectColors = {
  village:'#35745c', building:'#43617a', hospital:'#aa4351',
  school:'#395ba6', 'state-land':'#198579', 'collective-land':'#87724d',
};
export const isLand = category => category.endsWith('-land');
export const hectares = area => (area / 10000).toLocaleString('zh-CN', {minimumFractionDigits:2, maximumFractionDigits:2});

export function levelLabel(level, levels, mode = 'bands') {
  const next = levels[levels.indexOf(level) + 1];
  return mode === 'cumulative' || next === undefined ? `≥${level} dB` : `${level}–${next} dB`;
}

export function recordsForMode(bundle, mode) {
  return mode === 'cumulative' ? bundle.cumulative : bundle.bands;
}

export function bandVisible(level, state) {
  return state.level === null || (state.mode === 'cumulative' ? level >= state.level : level === state.level);
}

export function visibleNoiseArea(bundle, state) {
  const record = state.level === null
    ? bundle.cumulative[0]
    : recordsForMode(bundle, state.mode).find(record => record.level === state.level);
  return record?.areaM2;
}

export function matchingObjects(bundle, state) {
  return bundle.objects.filter(record => record.district === '海曙区'
    && (!state.town || record.town === state.town)
    && (!state.village || record.village === state.village)
    && (isLand(record.category)
      ? Object.keys(record.overlaps).some(level => bandVisible(Number(level), state))
      : bandVisible(record.highest, state)));
}

export function coveredArea(record, state) {
  return Object.entries(record.overlaps).reduce((total, [level, overlap]) => (
    total + (bandVisible(Number(level), state) ? (overlap.areaM2 ?? 0) : 0)
  ), 0);
}
