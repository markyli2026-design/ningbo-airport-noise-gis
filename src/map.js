import { bandVisible, colors, isLand, objectColors } from './analysis.js';
import { addBuildingTiles, buildingCredit, createTerrain, terrainCredit } from './reference-layers.js';
import { boundaryBounds, boundaryPolygons } from './administrative-boundaries.js';
import { buildingScope } from './building-scope.js';

const base = {
  street: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    reference: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    credit: '<a href="https://doc.arcgis.com/en/data-appliance/7.2/maps/world-light-gray-base.htm" target="_blank" rel="noopener">Esri 浅灰底图</a> · HERE, Garmin, OpenStreetMap contributors and the GIS User Community',
    max: 16,
  },
  satellite: {
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    credit: '<a href="https://www.esri.com/en-us/arcgis/products/arcgis-living-atlas/overview" target="_blank" rel="noopener">Esri World Imagery · Maxar, Earthstar Geographics and the GIS User Community</a>',
    max: 19,
  },
};

export function createMap(bundle, callbacks) {
  const C = window.Cesium;
  if (!C) throw new Error('Cesium 资源未加载');
  const viewer = new C.Viewer('map', {
    baseLayer: false, baseLayerPicker: false, geocoder: false,
    homeButton: false, sceneModePicker: false, navigationHelpButton: false,
    animation: false, timeline: false, fullscreenButton: false,
    infoBox: false, selectionIndicator: false, requestRenderMode: true,
    creditContainer: document.getElementById('map-credits'),
  });
  const scene = viewer.scene;
  scene.globe.baseColor = C.Color.fromCssColorString('#d9e6ed');
  scene.globe.showGroundAtmosphere = false;
  scene.fog.enabled = false;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
  const bands = new Map();
  const objects = new Map();
  let imagery = [];
  let activeBase;
  const creditDisplay = scene.frameState.creditDisplay;
  const buildingAttribution = new C.Credit(buildingCredit, true);
  const boundaryAttribution = new C.Credit('行政边界 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>', true);
  const boundaryEntities = [];
  let activeBoundary;
  let activeBoundaryBounds;
  let buildingRegion;
  let buildingFilterKey;
  let previousState;

  function updateBuildingFilter(state) {
    const key = JSON.stringify([state.level,state.mode,state.town,state.village,state.selected?.startsWith('mvt:') ? state.selected : null]);
    if (key === buildingFilterKey) return;
    buildingFilterKey = key;
    buildingTiles.setScope(buildingRegion === null ? [] : buildingScope(bundle,state,buildingRegion),
      Boolean(state.level !== null || state.town || state.village), state.selected);
  }
  const terrainAttribution = new C.Credit(terrainCredit, true);
  const ellipsoid = new C.EllipsoidTerrainProvider();
  let terrain;
  let terrainEnabled = false;
  let terrainStatus = '未开启';

  function setTerrain(show) {
    terrainEnabled = show;
    if (show) {
      if (!terrain) {
        terrainStatus = '正在加载高程瓦片…';
        terrain = createTerrain(C, status => {
          terrainStatus = status;
          if (terrainEnabled) callbacks.terrain(status);
        });
      }
      viewer.terrainProvider = terrain;
      creditDisplay.addStaticCredit(terrainAttribution);
      callbacks.terrain(terrainStatus);
    } else {
      viewer.terrainProvider = ellipsoid;
      creditDisplay.removeStaticCredit(terrainAttribution);
      callbacks.terrain('已关闭');
    }
    scene.requestRender();
  }

  function setBasemap(name) {
    const config = base[name];
    if (!config || name === activeBase) return;
    let failures = 0;
    for (const layer of imagery) viewer.imageryLayers.remove(layer);
    activeBase = name;
    imagery = [config.url, config.reference].filter(Boolean).map((url, index) => {
      const provider = new C.UrlTemplateImageryProvider({
        url, maximumLevel:config.max,
        credit:index === 0 ? new C.Credit(config.credit, true) : undefined,
      });
      provider.errorEvent.addEventListener(() => {
        if (activeBase === name && ++failures === 3) {
          callbacks.message(`${name === 'street' ? '电子底图' : '遥感影像'}部分瓦片加载失败，噪声图层可继续使用`);
        }
      });
      return viewer.imageryLayers.addImageryProvider(provider);
    });
    callbacks.message('');
    scene.requestRender();
  }

  const positions = ring => C.Cartesian3.fromDegreesArray(ring.flatMap(([lon, lat]) => [lon, lat]));
  const hierarchy = rings => new C.PolygonHierarchy(positions(rings[0]),
    rings.slice(1).map(ring => new C.PolygonHierarchy(positions(ring))));

  function setBoundary(feature, fly = false, exact = true) {
    if (activeBoundary !== feature) {
      for (const entity of boundaryEntities.splice(0)) viewer.entities.remove(entity);
      creditDisplay.removeStaticCredit(boundaryAttribution);
      activeBoundary = feature;
      activeBoundaryBounds = undefined;
      const polygons = feature ? boundaryPolygons(feature.geometry) : [];
      if (polygons.length) {
        const material = new C.PolylineOutlineMaterialProperty({
          color:C.Color.fromCssColorString('#1260b5'), outlineColor:C.Color.WHITE, outlineWidth:1.5,
        });
        for (const rings of polygons) for (const ring of rings) {
          boundaryEntities.push(viewer.entities.add({
            polyline:{positions:positions(ring), clampToGround:true, width:5, material, zIndex:20},
          }));
        }
        activeBoundaryBounds = boundaryBounds(polygons);
        if (feature.properties.source === 'OpenStreetMap') creditDisplay.addStaticCredit(boundaryAttribution);
      }
    }
    if (fly && activeBoundaryBounds) locate(activeBoundaryBounds);
    const region = exact ? feature : null;
    if (buildingRegion !== region) {
      buildingRegion = region;
      buildingFilterKey = undefined;
      if (previousState) updateBuildingFilter(previousState);
    }
    scene.requestRender();
  }

  function addGeometry(geometry, color, key, alpha, zIndex) {
    const entities = [];
    if (geometry.type === 'Point') {
      entities.push(viewer.entities.add({
        position: C.Cartesian3.fromDegrees(...geometry.coordinates.slice(0, 2)),
        point: {pixelSize: 10, color, outlineColor: C.Color.WHITE, outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY},
      }));
    } else {
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon' ? geometry.coordinates
        : geometry.geometries?.flatMap(part => part.type === 'Polygon' ? [part.coordinates]
          : part.type === 'MultiPolygon' ? part.coordinates : []) ?? [];
      for (const rings of polygons) {
        entities.push(viewer.entities.add({
          polygon: {hierarchy: hierarchy(rings), material: color.withAlpha(alpha), zIndex,
            classificationType: C.ClassificationType.TERRAIN},
        }));
        entities.push(viewer.entities.add({
          polyline: {positions: positions(rings[0]), clampToGround: true, width: 2, material: color},
        }));
      }
    }
    entities.forEach(entity => { entity.pickKey = key; });
    return entities;
  }

  function update(state, records) {
    previousState = state;
    updateBuildingFilter(state);
    viewer.entities.suspendEvents();
    try {
      bundle.bands.forEach((record, index) => {
        const key = `noise:${record.level}`;
        const visible = state.noiseVisible && bandVisible(record.level, state);
        const selected = state.selected === key
          || (state.mode === 'cumulative' && state.selected?.startsWith('noise:')
            && record.level >= Number(state.selected.split(':')[1]));
        const color = C.Color.fromCssColorString(colors[index]);
        if (!bands.has(record.level)) bands.set(record.level, addGeometry(record.geometry, color, key, state.alpha, index));
        for (const entity of bands.get(record.level)) {
          entity.show = visible;
          if (entity.polygon) entity.polygon.material = color.withAlpha(selected ? Math.min(.78, state.alpha + .20) : state.alpha);
          if (entity.polyline) entity.polyline.width = selected ? 4 : 2;
        }
      });
      const ids = new Set(records.map(record => record.id));
      for (const [id, entities] of objects) {
        if (!ids.has(id)) {
          entities.forEach(entity => viewer.entities.remove(entity));
          objects.delete(id);
        }
      }
      for (const record of records) {
        const color = C.Color.fromCssColorString(objectColors[record.category]);
        const selected = record.id === state.selected;
        const parts = isLand(record.category) ? Object.entries(record.overlaps)
          .filter(([level]) => bandVisible(Number(level), state)).map(([, part]) => part.geometry)
          : [record.geometry];
        const existing = objects.get(record.id);
        const key = isLand(record.category) ? `${state.mode}/${state.level}` : '';
        if (existing && existing.filterKey !== key) {
          existing.forEach(entity => viewer.entities.remove(entity));
          objects.delete(record.id);
        }
        if (!objects.has(record.id)) {
          const entities = parts.flatMap(geometry => addGeometry(geometry, color, record.id, .38, 10));
          if (isLand(record.category)) {
            const full = record.geometry.type === 'Polygon' ? [record.geometry.coordinates] : record.geometry.coordinates;
            for (const rings of full) {
              const outline = viewer.entities.add({
                polyline: {
                  positions: positions(rings[0]), clampToGround: true, width: 2,
                  material: new C.PolylineDashMaterialProperty({color}),
                },
              });
              outline.pickKey = record.id;
              outline.fullParcelOutline = true;
              entities.push(outline);
            }
          }
          entities.filterKey = key;
          objects.set(record.id, entities);
        }
        for (const entity of objects.get(record.id)) {
          if (entity.fullParcelOutline) entity.show = selected;
          if (entity.polygon) entity.polygon.material = color.withAlpha(selected ? .75 : .38);
          if (entity.polyline) entity.polyline.width = selected ? 4 : 2;
          if (entity.point) entity.point.pixelSize = selected ? 16 : 10;
        }
      }
    } finally {
      viewer.entities.resumeEvents();
    }
    scene.requestRender();
  }

  function destination(bounds) {
    const [w, s, e, n] = bounds;
    const dx = Math.max(.007, e - w) * .18;
    const dy = Math.max(.007, n - s) * .16;
    return C.Rectangle.fromDegrees(w - dx, s - dy, e + dx, n + dy);
  }

  function home() {
    viewer.camera.cancelFlight();
    viewer.camera.setView({destination: destination(bundle.bounds)});
    scene.requestRender();
  }
  function locate(bounds) {
    viewer.camera.flyTo({destination: destination(bounds), duration: .65});
    scene.requestRender();
  }
  function setMode() {
    if (scene.mode === C.SceneMode.MORPHING) return;
    if (scene.mode === C.SceneMode.SCENE2D) scene.morphTo3D(.45);
    else scene.morphTo2D(.45);
  }
  scene.morphComplete.addEventListener(() => {
    callbacks.mode(scene.mode === C.SceneMode.SCENE2D ? '三维' : '二维');
    home();
  });
  viewer.screenSpaceEventHandler.setInputAction(({position}) => {
    const hits = scene.drillPick(position, 20);
    const building = hits.find(value => value.id?.buildingRecord)?.id.buildingRecord;
    if (building) { callbacks.buildingPick(building); return; }
    const picked = hits.map(value => value.id?.pickKey).filter(Boolean);
    const object = picked.find(id => !id.startsWith('noise:'));
    const noise = picked.filter(id => id.startsWith('noise:')).sort((a,b) => Number(b.split(':')[1]) - Number(a.split(':')[1]))[0];
    if (object || noise) callbacks.pick(object ?? noise);
    else callbacks.clear();
  }, C.ScreenSpaceEventType.LEFT_CLICK);
  home();
  setBasemap('street');
  const buildingTiles = addBuildingTiles(C, viewer, bundle.bounds, callbacks.buildings);
  creditDisplay.addStaticCredit(buildingAttribution);
  return {
    update, setBasemap, setTerrain, setMode, home, locate, setBoundary,
    setBuildings(show) {
      buildingTiles.setBuildings(show);
      if (show) creditDisplay.addStaticCredit(buildingAttribution);
      else creditDisplay.removeStaticCredit(buildingAttribution);
    },
    zoom(direction) {
      const distance = Math.max(160, viewer.camera.positionCartographic.height * .23);
      if (direction > 0) viewer.camera.zoomIn(distance);
      else viewer.camera.zoomOut(distance);
      scene.requestRender();
    },
  };
}
