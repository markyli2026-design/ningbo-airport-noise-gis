import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { bandVisible, coveredArea, matchingObjects, visibleNoiseArea } from '../src/analysis.js';
import { boundaryBounds, resolveBoundary } from '../src/administrative-boundaries.js';
import { buildingInScope, buildingScope } from '../src/building-scope.js';

const bundle = JSON.parse(readFileSync(new URL('../public/airport-data.json', import.meta.url), 'utf8'));
const all = { mode:'bands', level:null, town:'', village:'' };

test('building highlighting requires area in the intersection of noise and village', () => {
  const rectangle = (w,s,e,n) => [[[w,s],[e,s],[e,n],[w,n],[w,s]]];
  const noise = {level:70,geometry:{type:'Polygon',coordinates:rectangle(0,0,4,4)}};
  const village = {geometry:{type:'Polygon',coordinates:rectangle(2,2,6,6)}};
  const scope = buildingScope({cumulative:[noise]},all,village);
  scope.bounds = boundaryBounds(scope);
  assert.equal(buildingInScope([rectangle(3,3,5,5)],scope), true);
  assert.equal(buildingInScope([rectangle(0,0,1,1)],scope), false);
  assert.equal(buildingInScope([rectangle(4,2,5,3)],scope), false);
});

test('the two sample villages resolve to their own polygons', () => {
  const {features} = JSON.parse(readFileSync(new URL('../public/administrative-boundaries.geojson', import.meta.url), 'utf8'));
  for (const [town,village] of [['石碶街道','栎社村'],['古林镇','古林村']]) {
    const boundary = resolveBoundary(features,'海曙区',town,village);
    assert.equal(boundary.exact,true);
    assert.equal(boundary.feature.properties.village,village);
  }
});

test('prepared noise uses nested simulated rectangles at the original scale', () => {
  assert.equal(bundle.simulated, true);
  assert.equal(bundle.sourceCount, 5);
  assert.deepEqual(bundle.bands.map(record => record.level), [70,75,80,85,90]);
  assert.ok(Math.abs(visibleNoiseArea(bundle, all) / 10000 - 6696.44) < 1);
  for (const record of bundle.cumulative) {
    assert.equal(record.geometry.type, 'Polygon');
    assert.equal(record.geometry.coordinates[0].length, 5);
    const sum = bundle.bands.filter(band => band.level >= record.level).reduce((total, band) => total + band.areaM2, 0);
    assert.ok(Math.abs(sum - record.areaM2) < 2);
  }
});

test('threshold changes use different area records and show the appropriate bands', () => {
  const bands = {...all, level:80};
  const cumulative = {...bands, mode:'cumulative'};
  assert.ok(Math.abs(visibleNoiseArea(bundle, bands) / 10000 - 666.83) < 1);
  assert.ok(Math.abs(visibleNoiseArea(bundle, cumulative) / 10000 - 1157.35) < 1);
  assert.deepEqual(bundle.bands.filter(record => bandVisible(record.level, cumulative)).map(record => record.level), [80,85,90]);
});

test('object counts and land area follow different inclusion rules across bands', () => {
  const base = {district:'海曙区',town:'古林镇',village:'古林村',highest:80,
    overlaps:{75:{areaM2:250},80:{areaM2:150}}};
  const parcel = {...base,id:'land',category:'state-land'};
  const fixture = {objects:[{...base,id:'building',category:'building'},parcel,
    {...base,id:'other',category:'state-land',town:'石碶街道'}]};
  const state = {...all,level:75,town:'古林镇'};
  assert.deepEqual(matchingObjects(fixture,state).map(record => record.id), ['land']);
  assert.equal(coveredArea(parcel,state),250);
  const cumulative = {...state,mode:'cumulative'};
  assert.deepEqual(matchingObjects(fixture,cumulative).map(record => record.id), ['building','land']);
  assert.equal(coveredArea(parcel,cumulative),400);
});

test('generated land records retain simulated provenance and use contour intersection area', () => {
  const synthetic = bundle.objects.filter(record => record.simulated);
  if (!synthetic.length) return; // Real ownership files replace the sample data.
  for (const category of ['state-land', 'collective-land']) {
    const parcels = synthetic.filter(record => record.category === category);
    assert.equal(parcels.length, 10);
    assert.deepEqual(new Set(parcels.map(record => record.town)), new Set(['古林镇', '石碶街道']));
    assert.equal(new Set(parcels.map(record => record.id)).size, parcels.length);
    assert.ok(parcels.some(record => coveredArea(record, all) < record.areaM2 * .95));
    for (const record of parcels) {
      const area = coveredArea(record, all);
      // Planar intersections add vertices before ellipsoidal area integration.
      assert.ok(area > 0 && area <= record.areaM2 + .1);
    }
  }
});
