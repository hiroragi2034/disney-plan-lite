declare module "*.css";
declare module "*.png";
declare module "*.jpg";
declare module "*.webp";
declare module "./hatch-maps.js";
declare module "./map_helpers.mjs" {
  export function mountPlaceListMap(
    container: HTMLElement,
    options: {
      places: { label: string; lat: number; lng: number }[];
      rows: HTMLElement[];
      baseStyle?: string;
      selectedClass?: string;
    },
    onUnavailable: () => void,
  ): { selectPlace: (index: number | null) => void } | null;
  export function buildStaticMapUrl(opts: {
    center: [number, number];
    zoom: number;
    width?: number;
    height?: number;
    scale?: number;
    markers?: { position: [number, number] }[];
  }): string;
}
