// Village names: Haishu District's published administrative division directory (2020).
// https://www.haishu.gov.cn/art/2020/8/21/art_1229829853_59034678.html
// The map geometry and associations with impact records are illustrative.
const regionTree = {
  '海曙区': {
    '石碶街道': ['上王村', '石碶村', '黄隘村', '车何渡村', '汪家村', '塘西村', '东杨村', '西杨村', '横涨村', '联丰村', '雅渡村', '星光村', '栎社村', '冯家村', '后仓村'],
    '古林镇': ['包家村', '宋严王村', '礼嘉桥村', '仲一村', '三星村', '布政村', '鹅颈村', '薛家村', '西洋港村', '前虞村', '龙三村', '藕池村', '张家潭村', '俞家村', '郭夏村', '古林村', '陈横楼村', '蜃蛟村', '共任村', '葑水港村', '茂新村', '施家村', '葑里村']
  }
};
const demoVillages = {'石碶街道': ['栎社村', '横涨村', '车何渡村'], '古林镇': ['古林村', '俞家村', '布政村']};
const villageIndices = {'石碶街道': 0, '古林镇': 0};
items.forEach((item, index) => {
  const street = item.x < 520 + (item.y + 100) * 0.2 ? '古林镇' : '石碶街道';
  const villages = demoVillages[street];
  const villageIndex = item.t === 0 ? villageIndices[street]++ : index + item.t;
  const village = villages[villageIndex % villages.length];
  Object.assign(item, {county:'海曙区', district:'海曙区', street, village});
  if (item.t === 0) item.name = village + '（演示）';
});
state.district = '海曙区';
state.street = 'all';
state.village = 'all';
const navigation = document.querySelector('nav');
const filters = document.querySelector('.filters');
const controlbar = document.createElement('div');
controlbar.className = 'controlbar';
document.body.insertBefore(controlbar, navigation);
controlbar.append(navigation, filters);
const topicLabels = {overview:'总体影响', buildings:'村和建筑', sensitive:'医院小学', land:'国有和集体用地'};
navigation.querySelectorAll('button').forEach(button => button.textContent = topicLabels[button.dataset.tab]);
const oldRegionLabel = $('district').parentElement;
oldRegionLabel.outerHTML = '<div class="region-control"><span>行政区域</span><button id="regionBtn" aria-expanded="false" aria-controls="regionPanel"><span id="regionPath">区县 / 街道 / 行政村</span>⌄</button></div>';
document.body.insertAdjacentHTML('beforeend', `<section id="regionPanel" class="region-panel" hidden aria-label="三级行政区域选择">
  <div class="region-title"><strong>行政区域</strong><button id="closeRegion" aria-label="收起行政区域">×</button></div>
  <div class="region-selects"><label>区县<select id="district" aria-label="区县"></select></label><label>街道 / 镇<select id="street" aria-label="街道或镇"></select></label><label>行政村<select id="village" aria-label="行政村"></select></label></div>
  <div class="caption">区划名称来源：<a href="https://www.haishu.gov.cn/art/2020/8/21/art_1229829853_59034678.html" target="_blank" rel="noopener noreferrer">海曙区政府行政区划名录（2020）</a>。对象分布和统计为演示。</div></section>`);
$('reset').textContent = '重置';
const listPanel = document.querySelector('.tablepanel');
listPanel.setAttribute('aria-label', '右侧对象清单');
const searchBox = $('search');
document.querySelector('.tablehead').insertAdjacentHTML('beforeend', '<button id="collapseList" aria-expanded="true">收起</button>');
const listBody = document.createElement('div');
listBody.id = 'listBody';
listBody.append(searchBox);
listBody.insertAdjacentHTML('beforeend', '<div id="objectCards" class="object-cards"></div>');
listPanel.append(listBody);
document.querySelector('.tablewrap').hidden = true;
$('mapSvg').setAttribute('preserveAspectRatio', 'xMidYMid slice');
document.querySelectorAll('.areaLabel').forEach((label, index) => label.textContent = index ? '石碶街道' : '古林镇');
$('mapSvg').parentElement.querySelector('.maptop').lastChild.textContent = ' · 地图和噪声范围为示意';
function regionText() {
  return [state.district, state.street, state.village].filter(value => value !== 'all').join(' / ') || '全部区域';
}
function updateRegionOptions() {
  const options = (values, label) => '<option value="all">全部' + label + '</option>' + values.map(value => '<option>' + value + '</option>').join('');
  $('district').innerHTML = Object.keys(regionTree).map(county => '<option>' + county + '</option>').join('');
  $('district').value = state.district;
  $('street').innerHTML = options(Object.keys(regionTree[state.district]), '街道 / 镇');
  $('street').value = state.street;
  $('street').disabled = state.district === 'all';
  $('village').innerHTML = options(state.street === 'all' ? [] : regionTree[state.district][state.street], '行政村');
  $('village').value = state.village;
  $('village').disabled = state.street === 'all';
  $('regionPath').textContent = [state.district, state.street === 'all' ? '全部街道 / 镇' : state.street, state.village === 'all' ? '全部行政村' : state.village].join(' / ');
  $('regionBtn').title = $('regionPath').textContent;
}
const priorBase = base;
base = function () {
  return priorBase().filter(item => (state.street === 'all' || item.street === state.street) && (state.village === 'all' || item.village === state.village));
};
const priorDetails = details;
details = function (item) {
  priorDetails(item);
  const regionRow = [...$('inspector').querySelectorAll('.detailrow')].find(row => row.firstElementChild.textContent === '行政区域');
  regionRow.innerHTML = '<span>行政区域</span><b>' + item.county + '<br>' + item.street + '<br>' + item.village + '</b>';
};
const priorRender = render;
render = function () {
  priorRender();
  $('summaryTitle').textContent = state.tab === 'overview' ? '影响范围总览' : topicLabels[state.tab];
  $('scope').textContent = $('scope').textContent.split(' · ')[0] + ' · ' + regionText();
  const shown = visible();
  $('count').textContent = shown.length + ' 个匹配对象';
  $('objectCards').innerHTML = shown.length ? shown.map(item => `<article class="object-card ${item.id === state.selected ? 'selected' : ''}">
    <div class="object-heading"><span class="type-icon" style="color:${palette[item.t]};background:${palette[item.t]}14">${['村','楼','医','学','国','集'][item.t]}</span><div><h3>${item.name}</h3><span class="object-code">${item.id} · ${item.type}</span></div><button data-id="${item.id}" aria-label="定位${item.name}">定位 ↗</button></div>
    <div class="object-region">${item.county} / ${item.street} / ${item.village}</div>
    <div class="object-foot"><span class="noise-badge">${item.band === 75 ? '≥75 dB' : item.band + '–' + (item.band + 5) + ' dB'}</span>${item.t >= 4 ? `<span>覆盖 <b>${landArea(item).toFixed(2)}</b> ha</span><span>${(landArea(item) / item.total * 100).toFixed(1)}%</span>` : `<span>${item.address}</span>`}</div>
  </article>`).join('') : '<div class="empty">当前条件下没有匹配对象<br>可调整区域、等级或搜索条件</div>';
};
$('objectCards').onclick = event => {
  const button = event.target.closest('[data-id]');
  if (button) select(button.dataset.id);
};
['district', 'street', 'village'].forEach(key => $(key).onchange = () => {
  state[key] = $(key).value;
  if (key === 'district') {state.street = 'all'; state.village = 'all';}
  if (key === 'street') state.village = 'all';
  state.selected = null;
  updateRegionOptions();
  render();
});
function closeRegion() {
  $('regionPanel').hidden = true;
  $('regionBtn').setAttribute('aria-expanded', 'false');
}
$('regionBtn').onclick = () => {
  const open = $('regionPanel').hidden;
  $('regionPanel').hidden = !open;
  $('regionBtn').setAttribute('aria-expanded', String(open));
};
$('closeRegion').onclick = closeRegion;
document.addEventListener('click', event => {
  if (!event.target.closest('#regionPanel') && !event.target.closest('#regionBtn')) closeRegion();
});
document.addEventListener('keydown', event => {if (event.key === 'Escape') closeRegion();});
$('reset').onclick = () => {
  Object.assign(state, {level:'all', mode:'bands', district:'海曙区', street:'all', village:'all', category:null, search:'', selected:null});
  $('level').value = 'all'; $('mode').value = 'bands'; $('search').value = '';
  [...$('level').options].forEach(option => {
    if (option.value !== 'all') option.textContent = option.value === '75' ? '75 dB及以上' : option.value + '–' + (+option.value + 5) + ' dB';
  });
  updateRegionOptions(); render();
};
$('collapseList').onclick = () => {
  const hidden = !$('listBody').hidden;
  $('listBody').hidden = hidden;
  $('collapseList').textContent = hidden ? '展开' : '收起';
  $('collapseList').setAttribute('aria-expanded', String(!hidden));
  listPanel.classList.toggle('collapsed', hidden);
};
// Convert pointer movement using the displayed SVG scale after full-screen sizing.
$('mapSvg').onpointermove = event => {
  if (!drag) return;
  const rect = $('mapSvg').getBoundingClientRect();
  const ratio = Math.min(1200 / rect.width, 720 / rect.height);
  state.panX = drag.px + (event.clientX - drag.x) * ratio;
  state.panY = drag.py + (event.clientY - drag.y) * ratio;
  view();
};
updateRegionOptions();
render();
const helpParagraphs = document.querySelectorAll('#help p');
helpParagraphs[0].textContent = '专题与筛选条件位于顶部同一行。选择石碶街道或古林镇后可筛选行政村。点击左侧统计数字筛选对象，在右侧卡片中点击定位查看地图与详情。';
helpParagraphs[2].textContent = '行政区划名称采用海曙区政府公布的名录。地图边界、对象位置、噪声阈值和影响统计均为构造示例。倾斜视角用于演示交互，实际底座与噪声成果待接入。';
