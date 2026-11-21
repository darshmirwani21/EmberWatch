import { area, bbox, booleanValid, featureCollection, intersect, kinks, polygon, union } from '@turf/turf';
import type { BBox, Feature, MultiPolygon, Polygon } from 'geojson';
import { assetGeometrySchema, businessAssetSchema, MAX_ASSET_VERTICES, PROPERTY_BOUNDARY, type AssetContact, type BusinessAsset } from './businessContracts';
import type { Coordinate } from './contracts';
import { interval, type Snapshot } from './engine';

export const SQUARE_METERS_PER_ACRE = 4046.8564224;
const MIN_SQUARE_METERS = .01;
type ExposureFrame = Pick<Snapshot, 'minute'> & { polygon: Feature<Polygon | MultiPolygon> };

export function businessPolygon(vertices: Coordinate[]): BusinessAsset['geometry'] {
  if (vertices.length < 3 || vertices.length > MAX_ASSET_VERTICES ||
    new Set(vertices.map((position) => position.join(','))).size !== vertices.length) {
    throw new Error('Draw a polygon with 3 to ' + MAX_ASSET_VERTICES + ' distinct corners.');
  }
  const geometry = assetGeometrySchema.parse({ type: 'Polygon', coordinates: [[...vertices, vertices[0]]] });
  const feature = polygon(geometry.coordinates);
  const bounds = bbox(feature);
  if (bounds[2] - bounds[0] > 180 || !booleanValid(feature) || kinks(feature).features.length || area(feature) <= MIN_SQUARE_METERS) {
    throw new Error('Draw a simple, non-crossing polygon with a measurable area.');
  }
  return geometry;
}

/** Canonicalize the saved area from geometry; never trust display or request totals. */
export function verifiedBusinessAsset(input: Omit<BusinessAsset, 'areaAcres'> & { areaAcres?: number }): BusinessAsset {
  const bounds = assetGeometrySchema.parse(input.geometry);
  const ring = bounds.coordinates[0];
  if (ring[0][0] !== ring.at(-1)?.[0] || ring[0][1] !== ring.at(-1)?.[1]) throw new Error('The asset polygon must be closed.');
  const geometry = businessPolygon(ring.slice(0, -1));
  return businessAssetSchema.parse({ ...input, geometry, areaAcres: area(polygon(geometry.coordinates)) / SQUARE_METERS_PER_ACRE });
}

function bboxOverlap(a: BBox, b: BBox) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function clippedAsset(shape: Feature<Polygon>, bounds: BBox, snapshot: ExposureFrame, snapshotBounds: BBox) {
  if (!bboxOverlap(bounds, snapshotBounds)) return null;
  const result = intersect(featureCollection([shape, snapshot.polygon]));
  return result && area(result) > MIN_SQUARE_METERS ? result : null;
}

export function indexBusinessExposure(assets: BusinessAsset[], snapshots: ExposureFrame[]) {
  const tracked = assets.filter((asset) => asset.category !== PROPERTY_BOUNDARY);
  if (!tracked.length) return [];
  const frames = snapshots.map((snapshot) => ({ snapshot, bounds: bbox(snapshot.polygon) }));
  return tracked.map((input) => {
    const asset = verifiedBusinessAsset(input);
    const shape = polygon(asset.geometry.coordinates);
    const bounds = bbox(shape);
    const contact = frames.find(({ snapshot, bounds: frameBounds }) => clippedAsset(shape, bounds, snapshot, frameBounds));
    return { asset, shape, bounds, firstContact: contact ? interval(contact.snapshot.minute) : null };
  });
}

export function measureBusinessExposure(index: ReturnType<typeof indexBusinessExposure>, snapshot: ExposureFrame) {
  const bounds = bbox(snapshot.polygon);
  const overlapShapes: Feature<Polygon | MultiPolygon>[] = [];
  const rows = index.map(({ asset, shape, bounds: assetBounds, firstContact }) => {
    const clip = clippedAsset(shape, assetBounds, snapshot, bounds);
    if (clip) overlapShapes.push(clip);
    const affectedAcres = clip ? Math.min(asset.areaAcres, area(clip) / SQUARE_METERS_PER_ACRE) : 0;
    const declaredValueInFootprint = asset.declaredValue === undefined ? null : asset.declaredValue * affectedAcres / asset.areaAcres;
    return { asset, affectedAcres, firstContact, declaredValueInFootprint, clip };
  });
  const affected = rows.filter((row) => row.affectedAcres > 0);
  const declared = affected.flatMap((row) => row.declaredValueInFootprint === null ? [] : [row.declaredValueInFootprint]);
  const total = overlapShapes.length > 1 ? union(featureCollection(overlapShapes)) : overlapShapes[0];
  const firstContact = rows.reduce<AssetContact | null>((first, row) => !row.firstContact ? first :
    !first || row.firstContact.to < first.to ? row.firstContact : first, null);
  return {
    rows, affectedAcres: total ? area(total) / SQUARE_METERS_PER_ACRE : 0, firstContact,
    declaredValueInFootprint: declared.length ? declared.reduce((sum, value) => sum + value, 0) : affected.length ? null : 0,
    unvaluedAffected: affected.length - declared.length, assetsAffected: affected.length,
  };
}
