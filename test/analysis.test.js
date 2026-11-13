import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { bandVisible, coveredArea, matchingObjects, visibleNoiseArea } from '../src/analysis.js';

const bundle = JSON.parse(readFileSync(new URL('../public/airport-data.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../data/机场噪音CGCS2000.shp', import.meta.url));
const all = { mode:'bands', level:null, town:'', village:'' };

test('prepared layers match the supplied shapefile and account for the complete coverage', () => {
  assert.equal(bundle.sourceHash, createHash('sha256').update(source).digest('hex'));
  assert.equal(bundle.sourceCount, 9);
  assert.deepEqual(bundle.bands.map(record => record.level), [70,75,80,85,90]);
  assert.equal((visibleNoiseArea(bundle, all) / 10000).toFixed(2), '6696.44');
  for (const record of bundle.cumulative) {
    const sum = bundle.bands.filter(band => band.level >= record.level).reduce((total, band) => total + band.areaM2, 0);
    assert.ok(Math.abs(sum - record.areaM2) < 1);
  }
});

test('threshold changes use different area records and show the appropriate bands', () => {
  const bands = {...all, level:80};
  const cumulative = {...bands, mode:'cumulative'};
  assert.equal((visibleNoiseArea(bundle, bands) / 10000).toFixed(2), '666.83');
  assert.equal((visibleNoiseArea(bundle, cumulative) / 10000).toFixed(2), '1157.35');
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
