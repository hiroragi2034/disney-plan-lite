declare module "*.css";
declare module "*.png";
declare module "*.jpg";
declare module "*.webp";
declare module "./hatch-maps.js";
declare module "./map_helpers.mjs" {
  export interface PlaceListMapHandle {
    destroy?: () => void;
    remove?: () => void;
    selectPlace?: (index: number) => void;
    panTo?: (target: { lat: number; lng: number }) => boolean;
    getZoom?: () => number | null;
    refreshSize?: () => void;
  }
  export function mountPlaceListMap(
    container: HTMLElement,
    options: {
      places: { label: string; lat: number; lng: number }[];
      rows: HTMLElement[];
      selectedClass?: string;
      baseLayer?: "standard" | "satellite";
      userLocation?: { lat: number; lng: number };
    },
    onUnavailable: () => void,
  ): PlaceListMapHandle | null;
  export function buildStaticMapUrl(opts: {
    center: [number, number];
    zoom: number;
    width?: number;
    height?: number;
    scale?: number;
    markers?: { position: [number, number] }[];
  }): string;
}
