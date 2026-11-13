"""Compile the supplied CGCS2000 contours and optional WGS84 object layers."""
import json
import re
from math import sqrt
from pathlib import Path

import shapefile
from shapely.affinity import scale
from pyproj import CRS, Geod, Transformer
from shapely import transform, union_all
from shapely.geometry import Polygon, box, mapping, shape
from shapely.geometry.polygon import orient
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SOURCE = DATA / "机场噪音CGCS2000.shp"
GEOD = Geod(ellps="WGS84")
LAYERS = {
    "village": "村",
    "building": "建筑",
    "hospital": "医院",
    "school": "小学",
    "state-land": "国有用地",
    "collective-land": "集体用地",
}


def area_m2(geometry):
    if geometry.is_empty:
        return 0
    if geometry.geom_type == "Polygon":
        return abs(GEOD.geometry_area_perimeter(orient(geometry))[0])
    return sum(area_m2(part) for part in getattr(geometry, "geoms", []))


def contours():
    prj = next(p for p in DATA.iterdir() if p.suffix.lower() == ".prj"
               and p.stem.casefold() == SOURCE.stem.casefold())
    crs = CRS.from_wkt(prj.read_text(encoding="utf-8-sig"))
    to_wgs84 = Transformer.from_crs(crs, 4326, always_xy=True)
    grouped = {}
    encoding = SOURCE.with_suffix(".cpg").read_text(encoding="utf-8-sig").strip()
    with shapefile.Reader(str(SOURCE), encoding=encoding) as reader:
        for row in reader.iterShapeRecords():
            match = re.fullmatch(r"CONTOUR_(\d+)-0", row.record.Layer)
            if not match or row.shape.shapeType != shapefile.POLYLINEZ:
                raise ValueError(f"Unrecognized noise record: {row.record}")
            ends = [*row.shape.parts, len(row.shape.points)]
            for start, end in zip(ends, ends[1:]):
                ring = row.shape.points[start:end]
                if len(ring) < 4 or ring[0] != ring[-1]:
                    raise ValueError(f"Open contour: {row.record.Layer}")
                polygon = transform(Polygon(ring), to_wgs84.transform, interleaved=False)
                if not polygon.is_valid or polygon.is_empty:
                    raise ValueError(f"Invalid contour: {row.record.Layer}")
                grouped.setdefault(int(match[1]), []).append(polygon)
    levels = sorted(grouped)
    cumulative = {level: union_all(grouped[level]) for level in levels}
    bands = {}
    for index, level in enumerate(levels):
        higher = cumulative[levels[index + 1]] if index + 1 < len(levels) else Polygon()
        if not higher.difference(cumulative[level]).is_empty:
            raise ValueError(f"Contours are not nested at {level}")
        bands[level] = cumulative[level].difference(higher)
    return grouped, cumulative, bands


def noise_records(geometries, counts):
    return [
        {
            "level": level,
            "areaM2": area_m2(geom),
            "sourceCount": counts[level],
            "geometry": mapping(geom),
            "bounds": geom.bounds,
        }
        for level, geom in geometries.items()
    ]


def simulated_contours(reference):
    """Use one nested rectangle per level, matching the reference scale and orientation."""
    project = Transformer.from_crs(4326, 32651, always_xy=True)
    unproject = Transformer.from_crs(32651, 4326, always_xy=True)
    outer = transform(next(iter(reference.values())), project.transform, interleaved=False)
    rectangle = outer.minimum_rotated_rectangle
    cumulative = {}
    for level, geometry in reference.items():
        target = transform(geometry, project.transform, interleaved=False).area
        ratio = sqrt(target / rectangle.area)
        footprint = scale(rectangle, xfact=ratio, yfact=ratio, origin="centroid")
        cumulative[level] = transform(footprint, unproject.transform, interleaved=False)
    levels = list(cumulative)
    bands = {
        level: cumulative[level].difference(cumulative[levels[index + 1]])
        if index + 1 < len(levels) else cumulative[level]
        for index, level in enumerate(levels)
    }
    return cumulative, bands


def demo_parcels(bands, categories):
    """Create reproducible sample parcels around the actual contours in UTM 51N."""
    project = Transformer.from_crs(4326, 32651, always_xy=True)
    unproject = Transformer.from_crs(32651, 4326, always_xy=True)
    claimed = []
    result = {category: [] for category in categories}
    for level, band in reversed(list(bands.items())):
        projected = transform(band, project.transform, interleaved=False)
        west, south, east, north = projected.bounds
        for category in categories:
            for sample in range(2):
                width = 125 + 15 * sample
                height = 102 + 13 * sample
                columns = range(int(west), int(east) + 1, 85)
                for x in (columns if sample == 0 else reversed(columns)):
                    for y in range(int(south), int(north) + 1, 85):
                        parcel = box(x, y, x + width, y + height)
                        fraction = projected.intersection(parcel).area / parcel.area
                        if fraction < .22 or (sample == 0 and fraction > .87):
                            continue
                        if any(parcel.buffer(120).intersects(other) for other in claimed):
                            continue
                        claimed.append(parcel)
                        geom = transform(parcel, unproject.transform, interleaved=False)
                        west_side = geom.centroid.x < 121.435
                        town = "古林镇" if west_side else "石碶街道"
                        village = "古林村" if west_side else "栎社村"
                        serial = len(result[category]) + 1
                        prefix = "GY" if category == "state-land" else "JT"
                        result[category].append({
                            "type": "Feature",
                            "properties": {
                                "id": f"{prefix}-{serial:02d}",
                                "name": f"{LAYERS[category]}模拟地块 {serial:02d}",
                                "district": "海曙区", "town": town, "village": village,
                            },
                            "geometry": mapping(geom),
                        })
                        break
                    else:
                        continue
                    break
    return result


def load_objects(bands):
    objects = []
    available = {}
    land = []
    missing_land = [category for category in LAYERS if category.endswith("-land")
                    and not (DATA / f"{category}.geojson").exists()]
    # Do not mix synthetic parcels with authoritative ownership data.
    synthetic = demo_parcels(bands, missing_land) if len(missing_land) == 2 else {}
    for category in LAYERS:
        path = DATA / f"{category}.geojson"
        simulated = category in synthetic
        available[category] = path.exists() or simulated
        if not available[category]:
            continue
        data = ({"type": "FeatureCollection", "features": synthetic[category]} if simulated
                else json.loads(path.read_text(encoding="utf-8-sig")))
        if data.get("type") != "FeatureCollection" or data.get("crs"):
            raise ValueError(f"{path.name} must be an RFC 7946 WGS84 FeatureCollection")
        seen = set()
        for feature in data["features"]:
            props = feature["properties"]
            required = ("id", "name", "district", "town", "village")
            if any(not str(props.get(key) or "").strip() for key in required):
                raise ValueError(f"{path.name} has missing required fields: {props}")
            record_id = str(props["id"])
            if record_id in seen:
                raise ValueError(f"{path.name} has duplicate id {record_id}")
            seen.add(record_id)
            geom = shape(feature["geometry"])
            is_land = category.endswith("-land")
            allowed = {"Polygon", "MultiPolygon"} if is_land or category in {"village", "building"} else {"Point", "Polygon", "MultiPolygon"}
            if geom.is_empty or not geom.is_valid or geom.geom_type not in allowed:
                raise ValueError(f"{path.name} has unsupported or invalid geometry: {record_id}")
            west, south, east, north = geom.bounds
            if not (-180 <= west <= east <= 180 and -90 <= south <= north <= 90):
                raise ValueError(f"{path.name} coordinates are outside WGS84: {record_id}")
            if is_land:
                land.append((record_id, geom))
            overlaps = {}
            if geom.geom_type == "Point":
                # A point shared by adjacent band boundaries belongs to the higher band.
                for level, band in reversed(list(bands.items())):
                    if band.covers(geom):
                        overlaps[level] = {"areaM2": None, "geometry": mapping(geom)}
                        break
            else:
                for level, band in bands.items():
                    part = geom.intersection(band)
                    area = area_m2(part)
                    if area > 0:
                        overlaps[level] = {"areaM2": area, "geometry": mapping(part)}
            if overlaps:
                objects.append({
                    **{key: str(props[key]) for key in required},
                    "id": f"{category}:{record_id}",
                    "sourceId": record_id,
                    "category": category,
                    "geometry": mapping(geom),
                    "bounds": geom.bounds,
                    "areaM2": area_m2(geom) if geom.geom_type != "Point" else None,
                    "overlaps": overlaps,
                    "highest": max(overlaps),
                    "source": "模拟地块（非权属调查成果）" if simulated else path.name,
                    "simulated": simulated,
                })
    # Prevent double-counting parcel area or mixing overlapping ownership classes.
    if land:
        tree = STRtree([geom for _, geom in land])
        for index, (record_id, geom) in enumerate(land):
            for other in tree.query(geom, predicate="intersects"):
                if other > index and area_m2(geom.intersection(land[other][1])) > 0.01:
                    raise ValueError(f"Overlapping parcels: {record_id}, {land[other][0]}")
    return available, objects


def main():
    _, reference, _ = contours()
    cumulative, bands = simulated_contours(reference)
    counts = dict.fromkeys(cumulative, 1)
    available, objects = load_objects(bands)
    bundle = {
        "source": "矩形噪声模拟数据",
        "sourceCrs": "WGS84",
        "simulated": True,
        "sourceCount": sum(counts.values()),
        "bounds": list(cumulative[min(cumulative)].bounds),
        "bands": noise_records(bands, counts),
        "cumulative": noise_records(cumulative, counts),
        "available": available,
        "objects": objects,
    }
    target = ROOT / "public" / "airport-data.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{sum(counts.values())} closed contours, {len(counts)} levels, {len(objects)} matched objects")


if __name__ == "__main__":
    main()
