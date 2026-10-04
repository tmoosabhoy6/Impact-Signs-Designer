export interface CatalogOption {
  id: string;
  label: string;
  asset?: string;
  proofLabel?: string;
  hex?: string;
  upcharge?: string;
  verified?: boolean;
  materials?: string[];
  scale?: 'wall' | 'ground';
}

export interface Catalog {
  catalog: {
    sizeLimits: { minIn: number; maxIn: number; typicalMinIn: number; typicalMaxIn: number };
    finishes: CatalogOption[];
    backgroundColors: CatalogOption[];
    backgroundTextures: CatalogOption[];
    borders: CatalogOption[];
    fonts: CatalogOption[];
    imageOptions: CatalogOption[];
    mountings: CatalogOption[];
    materials: CatalogOption[];
    processes: CatalogOption[];
    proofStyles: { id: string; label: string; description: string }[];
  };
  presets: { id: string; label: string; description: string }[];
}

export const SPEC_FIELDS = [
  { key: 'material', group: 'materials', label: 'Material' },
  { key: 'process', group: 'processes', label: 'Process' },
  { key: 'finish', group: 'finishes', label: 'Plaque finish' },
  { key: 'backgroundColor', group: 'backgroundColors', label: 'Background color' },
  { key: 'backgroundTexture', group: 'backgroundTextures', label: 'Background texture' },
  { key: 'border', group: 'borders', label: 'Border' },
  { key: 'font', group: 'fonts', label: 'Font' },
  { key: 'imageOption', group: 'imageOptions', label: 'Image option' },
  { key: 'mounting', group: 'mountings', label: 'Mounting' },
] as const;

/** URL of a library asset (served from the repo's assets/ folder). */
export const assetUrl = (asset?: string) => (asset ? `/library/${asset}` : '');
