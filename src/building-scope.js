import clipping from 'polygon-clipping';
import { boundaryBounds, boundaryPolygons } from './administrative-boundaries.js';
import { recordsForMode } from './analysis.js';

export function buildingScope(bundle, state, region) {
  const noise = (state.level === null ? bundle.cumulative : recordsForMode(bundle,state.mode))
    .find(record => record.level === (state.level ?? bundle.cumulative[0].level));
  const polygons = boundaryPolygons(noise.geometry);
  return region ? clipping.intersection(polygons, boundaryPolygons(region.geometry)) : polygons;
}

export function buildingInScope(polygons, scope) {
  if (!polygons.length || !scope.length) return false;
  const [w,s,e,n] = boundaryBounds(polygons);
  const [a,b,c,d] = scope.bounds;
  if (w >= c || e <= a || s >= d || n <= b) return false;
  return clipping.intersection(polygons, scope).length > 0;
}
