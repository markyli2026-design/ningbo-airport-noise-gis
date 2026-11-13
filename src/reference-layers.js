import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { boundaryBounds, boundaryPolygons } from './administrative-boundaries.js';
import { buildingInScope } from './building-scope.js';

const cartoTileJson = 'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json';
const elevationUrl = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
export const buildingCredit = '建筑轮廓 © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';
export const terrainCredit = '地形 <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Mapzen Terrain Tiles</a>';

export function addBuildingTiles(C, viewer, bounds, report) {
  const scene = viewer.scene;
  const collection = scene.groundPrimitives.add(new C.PrimitiveCollection());
  const scheme = new C.WebMercatorTilingScheme();
  const level = 14;
  const study = C.Rectangle.fromDegrees(...bounds);
  const entries = new Map();
  let enabled = true;
  let tileJson;
  let scope = [];
  let highlight = false;
  let selected;
  let revision = 0;
  const stateLabel = count => count ? `已加载 ${count.toLocaleString('zh-CN')} 个轮廓` : '当前范围无建筑轮廓';

  const positions = ring => C.Cartesian3.fromDegreesArray(ring.flatMap(([lon,lat]) => [lon,lat]));
  const polygonHierarchy = rings => new C.PolygonHierarchy(positions(rings[0]),
    rings.slice(1).map(ring => new C.PolygonHierarchy(positions(ring))));

  async function readTile(x, y, entry) {
    tileJson ??= fetch(cartoTileJson).then(response => {
      if (!response.ok) throw new Error(`TileJSON HTTP ${response.status}`);
      return response.json();
    }).catch(error => { tileJson = null; throw error; });
    const {tiles} = await tileJson;
    if (entry.abort.signal.aborted) return;
    const url = tiles[0].replace('{z}', level).replace('{x}', x).replace('{y}', y);
    const response = await fetch(url, {signal:entry.abort.signal});
    if (!response.ok) throw new Error(`MVT HTTP ${response.status}`);
    const layer = new VectorTile(new Pbf(await response.arrayBuffer())).layers.building;
    if (entry.abort.signal.aborted || !layer) return;
    const records = [];
    for (let index = 0; index < layer.length; index++) {
      const feature = layer.feature(index);
      if (feature.type !== 3) continue;
      const geometry = feature.toGeoJSON(x, y, level).geometry;
      const polygons = boundaryPolygons(geometry).filter(rings => rings[0].length >= 4);
      if (!polygons.length) continue;
      const id = `mvt:${x}/${y}/${feature.id ?? index}`;
      records.push({id,polygons,properties:feature.properties,bounds:boundaryBounds(polygons)});
    }
    entry.records = records;
    renderTile(entry);
  }

  function renderTile(entry) {
    if (!entry.records || entry.revision === revision) return;
    entry.revision = revision;
    if (entry.primitive) collection.remove(entry.primitive);
    entry.primitive = undefined;
    const instances = [];
    for (const record of entry.records) {
      if (!buildingInScope(record.polygons,scope)) continue;
      const color = C.Color.fromCssColorString(record.id === selected ? '#0055bd' : highlight ? '#1885df' : '#526d82')
        .withAlpha(record.id === selected ? .98 : .84);
      const pickId = {buildingRecord:record};
      for (const rings of record.polygons) {
        instances.push(new C.GeometryInstance({
          id:pickId,
          geometry: new C.PolygonGeometry({
            polygonHierarchy:polygonHierarchy(rings), vertexFormat:C.PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          attributes:{color:C.ColorGeometryInstanceAttribute.fromColor(color)},
        }));
      }
    }
    entry.count = instances.length;
    if (instances.length) entry.primitive = collection.add(new C.GroundPrimitive({
      geometryInstances:instances, classificationType:C.ClassificationType.TERRAIN,
      allowPicking:true,
    }));
    scene.requestRender();
  }

  function remove(key, entry) {
    entry.abort.abort();
    if (entry.primitive) collection.remove(entry.primitive);
    entries.delete(key);
  }
  function reportState() {
    if (!enabled) return;
    const values = [...entries.values()];
    if (values.some(entry => entry.pending)) return report('正在加载建筑瓦片…');
    const count = values.reduce((total,entry) => total + entry.count, 0);
    report(values.some(entry => entry.failed) ? `${stateLabel(count)} · 部分瓦片加载失败` : stateLabel(count));
  }
  function refresh() {
    if (!enabled) return;
    const view = viewer.camera.computeViewRectangle();
    const visible = view && C.Rectangle.intersection(view, study);
    const targets = new Map();
    if (visible) {
      const nw = scheme.positionToTileXY(C.Rectangle.northwest(visible), level);
      const se = scheme.positionToTileXY(C.Rectangle.southeast(visible), level);
      for (let x = nw.x; x <= se.x; x++) for (let y = nw.y; y <= se.y; y++) targets.set(`${x}/${y}`,[x,y]);
    }
    for (const [key,entry] of entries) if (!targets.has(key)) remove(key,entry);
    for (const [key,[x,y]] of targets) {
      if (entries.has(key)) continue;
      const entry = {abort:new AbortController(),count:0,pending:true};
      entries.set(key,entry);
      readTile(x,y,entry).catch(error => {
        if (error.name !== 'AbortError') entry.failed = true;
      }).finally(() => { entry.pending = false; reportState(); });
    }
    reportState();
  }
  viewer.camera.moveEnd.addEventListener(refresh);
  scene.morphComplete.addEventListener(refresh);
  viewer.resize();
  refresh();
  function setBuildings(show) {
    enabled = show;
    if (show) refresh();
    else {
      for (const [key,entry] of entries) remove(key,entry);
      report('已关闭');
    }
    scene.requestRender();
  }
  return {setBuildings, setScope(polygons, active, key) {
    scope = polygons;
    scope.bounds = boundaryBounds(polygons);
    highlight = active;
    selected = key;
    revision++;
    for (const entry of entries.values()) renderTile(entry);
    reportState();
  }};
}

export function createTerrain(C, report) {
  const width = 33;
  const maxLevel = 14;
  const cache = new Map();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d', {willReadFrequently:true});
  let pending = 0;
  let loaded = false;
  let failed = false;

  function elevationTile(x,y,z) {
    const key = `${z}/${x}/${y}`;
    if (cache.has(key)) return cache.get(key);
    if (pending >= 12) return undefined;
    pending++;
    const tile = fetch(`${elevationUrl}/${key}.png`, {signal:AbortSignal.timeout(12000)}).then(async response => {
      if (!response.ok) throw new Error(`DEM HTTP ${response.status}`);
      const image = await createImageBitmap(await response.blob(), {colorSpaceConversion:'none'});
      context.drawImage(image,0,0,256,256);
      image.close();
      const rgba = context.getImageData(0,0,256,256).data;
      loaded = true;
      report(failed ? '部分高程瓦片不可用' : '高程瓦片已加载');
      return rgba;
    }).catch(() => {
      failed = true;
      report(loaded ? '部分高程瓦片不可用' : '地形服务暂不可用，使用平坦底面');
      return null;
    }).finally(() => { pending--; });
    cache.set(key,tile);
    if (cache.size > 160) cache.delete(cache.keys().next().value);
    return tile;
  }

  function heightAt(rgba,x,y) {
    const offset = 4 * (y * 256 + x);
    return rgba[offset] * 256 + rgba[offset+1] + rgba[offset+2] / 256 - 32768;
  }
  function sample(rgba,x,y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(255,x0+1), y1 = Math.min(255,y0+1);
    const dx = x-x0, dy = y-y0;
    const top = heightAt(rgba,x0,y0)*(1-dx) + heightAt(rgba,x1,y0)*dx;
    const bottom = heightAt(rgba,x0,y1)*(1-dx) + heightAt(rgba,x1,y1)*dx;
    return top*(1-dy) + bottom*dy;
  }
  return new C.CustomHeightmapTerrainProvider({
    width, height:width, tilingScheme:new C.WebMercatorTilingScheme(),
    callback(x,y,level) {
      const sourceLevel = Math.min(level,maxLevel);
      const factor = 2 ** (level-sourceLevel);
      const sourceX = Math.floor(x/factor), sourceY = Math.floor(y/factor);
      const tile = elevationTile(sourceX,sourceY,sourceLevel);
      if (!tile) return undefined;
      return tile.then(rgba => {
        const heights = new Float32Array(width*width);
        if (!rgba) return heights;
        for (let row=0; row<width; row++) for (let col=0; col<width; col++) {
          const px = (x % factor + col/(width-1)) * 255/factor;
          const py = (y % factor + row/(width-1)) * 255/factor;
          heights[row*width+col] = sample(rgba,px,py);
        }
        return heights;
      });
    },
  });
}
