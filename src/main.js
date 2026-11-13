import './style.css';
import {
  categories, topics, towns, colors, objectColors, isLand, hectares, levelLabel,
  recordsForMode, visibleNoiseArea, matchingObjects, coveredArea, isFacility, facilityDirectory,
} from './analysis.js';
import { createMap } from './map.js';
import { boundaryPolygons, resolveBoundary } from './administrative-boundaries.js';
import { area as polygonArea } from './geometry-area.js';

const byId = id => document.getElementById(id);
const state = {
  topic:'overview', level:null, mode:'bands', town:'', village:'', category:'',
  list:'noise', query:'', selected:null, noiseVisible:true, alpha:.28,
};
let bundle;
let map;
let levels = [];
let boundaries = [];
let boundaryState = 'loading';
let pickedBuilding;
const formatArea = area => area === undefined ? '—' : hectares(area);
const label = level => levelLabel(level, levels, state.mode);
const hue = level => colors[levels.indexOf(level) % colors.length];
const html = value => String(value).replace(/[&<>"']/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
}[character]));
const dot = color => `<i class="dot" style="--dot:${color}" aria-hidden="true"></i>`;
const showMessage = message => {
  byId('map-message').hidden = !message;
  byId('map-message').textContent = message;
};

function setOptions(select, values, first) {
  select.replaceChildren(new Option(first, ''), ...values.map(([text, value]) => new Option(text, value)));
}
function refreshLevels() {
  setOptions(byId('noise-level'), levels.map(level => [label(level), level]), '全部等级');
  byId('noise-level').value = state.level ?? '';
}
function refreshRegion() {
  const names = state.town ? towns[state.town].split(' ').map(name => name + '村') : [];
  const extra = bundle?.objects.filter(object => object.district === '海曙区' && object.town === state.town)
    .map(object => object.village) ?? [];
  const boundaryNames = boundaries.filter(({properties}) => properties.town === state.town && properties.village)
    .map(({properties}) => properties.village);
  setOptions(byId('village'), [...new Set([...names, ...extra, ...boundaryNames])].map(name => [name,name]), '全部行政村');
  byId('village').disabled = !state.town;
  byId('town').value = state.town;
  byId('village').value = state.village;
  const path = ['海曙区', state.town || '全部街道、镇', state.village].filter(Boolean).join(' / ');
  byId('region-open').textContent = path;
}
function refreshBoundary(fly = false) {
  const status = byId('boundary-status');
  const {feature, requested, displayed, exact} = resolveBoundary(boundaries, '海曙区', state.town, state.village);
  map?.setBoundary(feature, fly, exact);
  if (boundaryState === 'loading') {
    status.textContent = '正在加载行政边界…';
  } else if (boundaryState === 'failed') {
    status.textContent = '行政边界加载失败';
  } else if (exact) {
    status.textContent = `边界 · ${displayed}${feature.properties.village ? '（历史参考）' : ''}`;
  } else {
    status.textContent = `${requested}边界未接入${displayed ? `，显示${displayed}边界` : ''}`;
  }
  status.classList.toggle('boundary-visible', Boolean(feature));
}

async function loadBoundaries() {
  try {
    const response = await fetch(new URL('./administrative-boundaries.geojson', location.href));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid boundary data');
    boundaries = data.features.filter(feature => feature.properties?.district && feature.geometry
      && boundaryPolygons(feature.geometry).length);
    boundaryState = 'ready';
    refreshRegion();
  } catch (error) {
    boundaryState = 'failed';
    console.warn('行政边界加载失败', error);
  }
  refreshBoundary(Boolean(state.town));
}
function noiseRecords() {
  return recordsForMode(bundle, state.mode).filter(record => state.level === null || state.level === record.level);
}
function objectRecords() {
  return matchingObjects(bundle, state).filter(record => topics[state.topic].includes(record.category)
    && (!state.category || record.category === state.category));
}
function listObjects() {
  if (state.topic !== 'services' || state.list !== 'directory') return objectRecords();
  return facilityDirectory(bundle,state).filter(record => !state.category || record.category === state.category);
}
function showPopover(button, panel, open) {
  byId(panel).hidden = !open;
  byId(button).setAttribute('aria-expanded', String(open));
}
function update(changes = {}, refresh = true) {
  Object.assign(state, changes);
  if (refresh) render();
}

function renderMetrics() {
  const matched = matchingObjects(bundle, state);
  byId('scope').textContent = [state.level === null ? '全部等级' : label(state.level), '海曙区', state.town, state.village].filter(Boolean).join(' · ');
  byId('area').textContent = formatArea(visibleNoiseArea(bundle, state));
  byId('area-note').textContent = '完整模拟范围 · 未按行政区裁切';
  byId('metrics').innerHTML = Object.entries(categories).map(([category, [name, unit]]) => {
    const available = bundle.available[category];
    const objects = matched.filter(record => record.category === category);
    const simulated = bundle.objects.some(record => record.category === category && record.simulated);
    const unlocated = isFacility(category) && facilityDirectory(bundle,state).some(record => record.category === category && !record.geometry);
    const value = !available ? '—' : isLand(category)
      ? hectares(objects.reduce((sum, record) => sum + coveredArea(record, state), 0))
      : unlocated && !objects.length ? '—' : objects.length;
    const count = available && isLand(category) ? `<span class="parcel-count">${objects.length} 个地块${simulated ? ' · 模拟' : ''}</span>` : '';
    return `<button class="metric" data-category="${category}" aria-pressed="${state.category === category}" ${available ? '' : 'disabled'}><strong>${value}</strong><span>${name} · ${!available ? '未接入' : unlocated && !objects.length ? '有待定位' : unit}</span>${count}</button>`;
  }).join('');
  const chart = recordsForMode(bundle, state.mode);
  const max = Math.max(...chart.map(record => record.areaM2));
  byId('chart-title').textContent = state.mode === 'bands' ? '分级覆盖面积 · ha' : '阈值覆盖面积 · ha';
  byId('bars').innerHTML = chart.map(record => `<button class="bar-row" data-level="${record.level}" aria-pressed="${record.level === state.level}"><span>${label(record.level)}</span><span class="bar-track"><i style="width:${record.areaM2/max*100}%;background:${hue(record.level)}"></i></span><span>${hectares(record.areaM2)}</span></button>`).join('');
  byId('legend').innerHTML = levels.map(level => `<button data-level="${level}" class="badge" aria-pressed="${level === state.level}">${dot(hue(level))}${label(level)}</button>`).join('');
  byId('summary-note').textContent = state.mode === 'cumulative'
    ? '各阈值范围逐级包含，面积不能相加。' : '各模拟分区互不重叠。';
}

function renderList(objects) {
  const noise = state.topic === 'overview' && state.list === 'noise';
  const services = state.topic === 'services';
  const directory = services && state.list === 'directory';
  const query = state.query.trim().toLocaleLowerCase();
  const records = noise ? noiseRecords() : objects;
  const shown = records.filter(record => (
    noise ? `${label(record.level)} ${record.level} 噪声` : `${record.name} ${record.sourceId} ${record.town} ${record.village}`
  ).toLocaleLowerCase().includes(query));
  byId('list-switch').hidden = state.topic !== 'overview' && !services;
  byId('list-switch').innerHTML = services
    ? '<button data-list="objects">范围内设施</button><button data-list="directory">设施名录</button>'
    : '<button data-list="noise">噪声分区</button><button data-list="objects">受影响对象</button>';
  byId('list-title').textContent = directory ? '公共设施名录' : services ? '噪声范围内设施' : noise ? '噪声范围' : '范围内对象';
  for (const button of document.querySelectorAll('[data-list]')) button.setAttribute('aria-pressed', button.dataset.list === state.list);
  const missing = noise ? [] : topics[state.topic].filter(category => !bundle.available[category])
    .map(category => categories[category][0]);
  const pending = services ? facilityDirectory(bundle,state).filter(record => !record.geometry).length : 0;
  byId('list-count').textContent = !shown.length && missing.length ? '对象数据不完整'
    : `${shown.length} ${noise ? '个等级' : '个匹配对象'}${pending ? ' · ' + pending + ' 处待定位' : ''}`;
  byId('cards').innerHTML = shown.map(record => {
    const key = noise ? `noise:${record.level}` : record.id;
    const name = noise ? label(record.level) : record.name;
    const color = noise ? hue(record.level) : objectColors[record.category];
    const subline = noise ? `<span>${state.mode === 'bands' ? '互斥分区' : '累计阈值'}</span><strong>${hectares(record.areaM2)} ha</strong>`
      : `<span>${html([record.town,record.village].filter(Boolean).join(' / '))}</span><strong>${!record.geometry ? '待定位' : isLand(record.category) ? hectares(coveredArea(record,state)) + ' ha' : record.highest === null ? '模拟范围外' : '≥' + record.highest + ' dB'}</strong>`;
    return `<article class="card${state.selected === key ? ' selected' : ''}">
      <div class="card-top"><h3 class="badge">${dot(color)}${html(name)}</h3><button data-locate="${html(key)}" aria-label="${record.geometry ? '定位' : '查看'}${html(name)}">${record.geometry ? '定位 ↗' : '查看'}</button></div>
      <div class="subline">${subline}</div></article>`;
  }).join('');
  if (shown.length) return;
  byId('cards').innerHTML = missing.length && !shown.length
    ? `<p class="empty"><strong>对象图层未接入</strong>缺少${missing.join('、')}数据。接入对应图层后可查看影响数量、覆盖面积及明细。</p>`
    : '<p class="empty">当前条件下没有匹配记录。</p>';
}

function selection() {
  if (!state.selected) return;
  if (state.selected === pickedBuilding?.id) {
    const {properties,polygons,id} = pickedBuilding;
    const rows = [
      ['瓦片编号',id.slice(4)],
      ['轮廓面积',polygonArea(polygons).toFixed(1) + ' m²'],
      ['筛选范围',byId('region-open').textContent],
      ['噪声条件',state.level === null ? '全部等级（模拟）' : label(state.level) + '（模拟）'],
      ['数据来源','CARTO / OpenStreetMap 建筑矢量瓦片'],
    ];
    if (properties.render_height != null) rows.splice(2,0,['瓦片高度',properties.render_height + ' m']);
    return {title:properties.name || '建筑轮廓',rows};
  }
  if (state.selected.startsWith('noise:')) {
    const level = Number(state.selected.split(':')[1]);
    const record = recordsForMode(bundle, state.mode).find(item => item.level === level);
    if (record) return {record, title:label(level), rows:[
      ['统计方式', state.mode === 'bands' ? '互斥分区' : '累计阈值'],
      ['覆盖面积', hectares(record.areaM2) + ' ha'],
      ['模拟矩形数', record.sourceCount],
      ['数据来源', bundle.source],
    ]};
  } else {
    const record = listObjects().find(item => item.id === state.selected);
    if (record) {
      const area = coveredArea(record, state);
      const rows = [['编号',record.sourceId], ['行政区域',[record.district,record.town,record.village].filter(Boolean).join(' / ')],
        ['最高涉及等级', !record.geometry ? '待定位，未判定' : record.highest === null ? '模拟范围外' : `${record.highest} dB`], ['数据来源',record.source]];
      if (record.kind) rows.push(['设施类别',record.kind]);
      if (record.address) rows.push(['公开地址',record.address]);
      if (record.villageReference) rows.push(['村级归属','按历史村界参考匹配']);
      if (isFacility(record.category) && record.geometry?.type === 'Point') rows.push(['空间口径','点位判定，不代表整个院区或校区']);
      if (record.areaM2) {
        rows.push(['完整面积',hectares(record.areaM2) + ' ha'], ['覆盖面积',hectares(area) + ' ha'],
          ['覆盖比例',(area/record.areaM2*100).toFixed(1) + '%']);
      }
      if (isLand(record.category)) rows.push(['地图说明','虚线为完整地块边界，填色为噪声覆盖部分']);
      if (record.simulated) rows.push(['权属及归属','模拟数据，仅用于功能演示']);
      return {record,title:record.name,rows};
    }
  }
}

function render() {
  if (!bundle) return;
  for (const button of document.querySelectorAll('[data-topic]')) button.setAttribute('aria-pressed', button.dataset.topic === state.topic);
  renderMetrics();
  const objects = listObjects();
  renderList(objects);
  const detail = selection();
  byId('detail').hidden = !detail;
  if (detail) {
    const links = [['公示来源',detail.record?.sourceUrl],['地图点位',detail.record?.locationUrl]]
      .filter(([,url]) => url?.startsWith('https://'))
      .map(([label,url]) => `<a href="${html(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`).join(' · ');
    byId('detail').innerHTML = `<div class="popover-title"><h2>${html(detail.title)}</h2><button id="detail-close" aria-label="关闭详情">×</button></div><dl>${detail.rows.map(([key,value]) => `<div><dt>${key}</dt><dd>${html(value)}</dd></div>`).join('')}</dl>${links ? '<p class="footnote">' + links + '</p>' : ''}`;
  }
  map?.update(state, objects.filter(record => record.geometry));
}

function chooseLevel(level) {
  const next = Number(level);
  const value = state.level === next ? null : next;
  byId('noise-level').value = value ?? '';
  update({level:value, selected:null});
}
function select(key, fly = false) {
  // Picking a visible band in cumulative mode shows the threshold being inspected.
  update({selected:key});
  const detail = selection();
  if (fly && detail?.record?.bounds) map?.locate(detail.record.bounds);
}

function bind() {
  setOptions(byId('town'), Object.keys(towns).map(name => [name,name]), '全部街道、镇');
  refreshRegion();
  refreshLevels();
  document.querySelector('nav').onclick = event => {
    const button = event.target.closest('[data-topic]');
    if (!button) return;
    byId('search').value = '';
    update({topic:button.dataset.topic, category:'', selected:null, query:'', list:button.dataset.topic === 'services' ? 'directory' : 'noise'});
  };
  byId('noise-level').onchange = event => update({level:event.target.value ? Number(event.target.value) : null,selected:null});
  byId('mode').onchange = event => {
    update({mode:event.target.value,selected:null},false);
    refreshLevels();
    render();
  };
  byId('town').onchange = event => {
    update({town:event.target.value,village:'',selected:null},false);
    refreshRegion();
    refreshBoundary(true);
    render();
  };
  byId('village').onchange = event => {
    update({village:event.target.value,selected:null},false);
    refreshRegion();
    refreshBoundary(true);
    render();
  };
  byId('reset').onclick = () => {
    update({topic:'overview',level:null,mode:'bands',town:'',village:'',category:'',list:'noise',query:'',selected:null},false);
    byId('mode').value = state.mode;
    byId('search').value = '';
    refreshRegion();
    refreshLevels();
    render();
    refreshBoundary();
    map?.home();
  };
  byId('metrics').onclick = event => {
    const category = event.target.closest('[data-category]')?.dataset.category;
    if (!category || !bundle.available[category]) return;
    const topic = isFacility(category) ? 'services' : !topics[state.topic].includes(category) ? 'overview' : state.topic;
    update({topic,category:state.category === category ? '' : category,list:isFacility(category) ? 'directory' : 'objects',selected:null});
  };
  for (const id of ['bars','legend']) byId(id).onclick = event => {
    const button = event.target.closest('[data-level]');
    if (button) chooseLevel(button.dataset.level);
  };
  byId('list-switch').onclick = event => {
    const button = event.target.closest('[data-list]');
    if (button) {
      byId('search').value = '';
      update({list:button.dataset.list,query:'',selected:null});
    }
  };
  byId('search').oninput = event => { state.query = event.target.value; renderList(listObjects()); };
  byId('cards').onclick = event => {
    const button = event.target.closest('[data-locate]');
    if (button) select(button.dataset.locate,true);
  };
  byId('detail').onclick = event => { if (event.target.closest('#detail-close')) update({selected:null}); };
  byId('collapse').onclick = () => {
    const hide = !byId('list-body').hidden;
    byId('list-body').hidden = hide;
    byId('collapse').textContent = hide ? '展开' : '收起';
    byId('collapse').setAttribute('aria-expanded',String(!hide));
    document.querySelector('.object-panel').classList.toggle('collapsed',hide);
  };
  byId('region-open').onclick = () => showPopover('region-open','region-panel',byId('region-panel').hidden);
  byId('region-close').onclick = () => showPopover('region-open','region-panel',false);
  byId('layers-open').onclick = () => showPopover('layers-open','layers',byId('layers').hidden);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      showPopover('region-open','region-panel',false);
      showPopover('layers-open','layers',false);
      update({selected:null});
    }
  });
  byId('layers').onchange = event => {
    if (event.target.name === 'basemap') map?.setBasemap(event.target.value);
    if (event.target.id === 'buildings-visible') map?.setBuildings(event.target.checked);
    if (event.target.id === 'terrain-visible') map?.setTerrain(event.target.checked);
    if (event.target.id === 'noise-visible') update({noiseVisible:event.target.checked});
  };
  byId('opacity').oninput = event => {
    state.alpha = Number(event.target.value)/100;
    map?.update(state,listObjects().filter(record => record.geometry));
  };
  byId('zoom-in').onclick = () => map?.zoom(1);
  byId('zoom-out').onclick = () => map?.zoom(-1);
  byId('home').onclick = () => map?.home();
  byId('scene-mode').onclick = () => map?.setMode();
  byId('fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { showMessage('当前浏览器未允许页面全屏，可使用浏览器全屏功能。'); }
  };
  document.addEventListener('fullscreenchange', () => {
    byId('fullscreen').textContent = document.fullscreenElement ? '退出全屏' : '全屏';
  });
}

byId('source-open').onclick = () => byId('source-dialog').showModal();
async function start() {
  try {
    const response = await fetch(new URL('./airport-data.json', location.href));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bundle = await response.json();
    levels = bundle.bands.map(record => record.level);
    byId('source-summary').textContent = `${bundle.source} · ${bundle.sourceCrs} · ${levels.length} 个等级`;
    byId('noise-level').disabled = false;
    bind();
    render();
  } catch (error) {
    console.error(error);
    showMessage('噪声成果加载失败，请检查 airport-data.json。');
    return;
  }
  try {
    map = createMap(bundle,{message:showMessage, mode:text => byId('scene-mode').textContent = text,
      buildings:text => byId('buildings-status').textContent = text,
      terrain:text => byId('terrain-status').textContent = text,
      buildingPick:record => { pickedBuilding = record; update({selected:record.id}); },
      pick:key => select(key), clear:() => update({selected:null})});
    render();
  } catch (error) {
    console.error(error);
    showMessage('Cesium 地图初始化失败，请在支持 WebGL 的浏览器中打开。面积统计仍可查看。');
  }
  void loadBoundaries();
}
start();
