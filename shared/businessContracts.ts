import { z } from 'zod';
import { DAY_HORIZON_MINUTES } from './simulationTime';

export const MAX_BUSINESS_ASSETS = 16;
export const MAX_ASSET_VERTICES = 40;
export const MAX_DECLARED_VALUE = 1_000_000_000;
export const PROPERTY_BOUNDARY = 'Property boundary';

const position = z.tuple([z.number().min(-180).max(180), z.number().min(-84).max(84)]);
export const assetGeometrySchema = z.strictObject({
  type: z.literal('Polygon'),
  coordinates: z.tuple([z.array(position).min(4).max(MAX_ASSET_VERTICES + 1)]),
});
export const businessAssetSchema = z.strictObject({
  id: z.string().regex(/^[\w-]{1,64}$/),
  name: z.string().trim().min(1).max(60),
  category: z.string().trim().min(1).max(50),
  geometry: assetGeometrySchema,
  areaAcres: z.number().positive(),
  declaredValue: z.number().nonnegative().max(MAX_DECLARED_VALUE).optional(),
  fictional: z.boolean().optional(),
}).refine((asset) => asset.category !== PROPERTY_BOUNDARY || asset.declaredValue === undefined, 'Property boundaries do not carry an asset value.');
export const businessAssetsSchema = z.array(businessAssetSchema).max(MAX_BUSINESS_ASSETS).refine(
  (assets) => new Set(assets.map((asset) => asset.id)).size === assets.length, 'Asset IDs must be unique.',
);
export const businessContextSchema = z.strictObject({
  minute: z.number().int().min(0).max(DAY_HORIZON_MINUTES).multipleOf(5),
  assets: businessAssetsSchema.optional(),
});
export type BusinessAsset = z.infer<typeof businessAssetSchema>;

export type AssetContact = { from: number; to: number };
export type BusinessEvidenceRow = {
  ref: string; name: string; fictional: boolean; areaAcres: number; affectedAcres: number;
  firstContact: AssetContact | null; declaredValueInFootprint: number | null;
};
export type BusinessEvidence = {
  minute: number; scenario: string; affectedAcres: number; firstContact: AssetContact | null;
  declaredValueInFootprint: number | null; assetsAffected: number; unvaluedAffected: number;
  fictionalAssets: boolean; rows: BusinessEvidenceRow[];
};

export type AirQualityForecast = {
  grid: { lat: number; lng: number };
  hours: { validAt: string; pm25: number | null }[];
  wind: { speedMph: number; fromDeg: number; validAt: string } | null;
};
export const SMOKE_LIMITATION = 'Regional PM2.5 includes particles from multiple sources. Wind and distance alone cannot reliably determine vineyard smoke exposure or grape smoke taint.';
export const VALUE_LIMITATION = 'Declared value inside the footprint is allocated by overlap area. It is not a predicted financial loss.';
export const AIR_QUALITY_SOURCE = 'Open-Meteo / Copernicus Atmosphere Monitoring Service (CAMS Global)';
export const AIR_QUALITY_URL = 'https://open-meteo.com/en/docs/air-quality-api';
export const SMOKE_RESEARCH_URL = 'https://ucanr.edu/blog/green-blog/article/uc-researchers-study-smoke-risk-vineyards-prescribed-grassland-fires';
