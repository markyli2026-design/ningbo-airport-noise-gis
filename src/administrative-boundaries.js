export function resolveBoundary(features, district, town, village) {
  const inDistrict = features.filter(feature => feature.properties.district === district);
  const find = (parent, child) => inDistrict.find(({properties}) =>
    (properties.town || '') === parent && (properties.village || '') === child);
  const requested = village || town || district;
  const feature = (village && find(town, village)) || (town && find(town, '')) || find('', '');
  const displayed = feature && (feature.properties.village || feature.properties.town || district);
  return {feature, requested, displayed, exact: displayed === requested};
}

export function boundaryPolygons(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

export function boundaryBounds(polygons) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const rings of polygons) {
    for (const [lon, lat] of rings[0]) {
      bounds[0] = Math.min(bounds[0], lon);
      bounds[1] = Math.min(bounds[1], lat);
      bounds[2] = Math.max(bounds[2], lon);
      bounds[3] = Math.max(bounds[3], lat);
    }
  }
  return bounds;
}
