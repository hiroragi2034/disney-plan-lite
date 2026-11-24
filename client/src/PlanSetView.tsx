import {
useCallback,
useEffect,
useRef,
useState,
type CSSProperties,
type ReactNode,
type RefObject
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import "./hatch-maps.js";
import "./hatch-maps.css";
import { buildStaticMapUrl, mountPlaceListMap } from "./map_helpers.mjs";

type SetDetail = NonNullable<ApiResponse<typeof api, "getPlanSet">["set"]>;
type Plan = SetDetail["plans"][number];
type Row = Plan["rows"][number];
type Condition = SetDetail["condition"];
type SubTab = "A" | "B" | "C";
type Entry = { item: Row; color: string };

const PLAN_COLORS: Record<SubTab, string> = {
  A: "var(--plan-a)",
  B: "var(--plan-b)",
  C: "var(--plan-c)",
};

const KIND_LABELS: Record<string, string> = {
  attraction: "アトラクション",
  show: "ショー",
  parade: "パレード",
  restaurant: "レストラン",
  break: "休憩",
  move: "移動",
  other: "その他",
  purchase: "DPA購入",
  first10: "入園後の最初の10分",
};

// One colour per schedule-row kind, so the type of each stop reads at a
// glance. Fixed hues with white chip text work in both colour schemes.
const KIND_COLORS: Record<string, string> = {
  attraction: "#2f6fd0",
  show: "#d6336c",
  parade: "#e8890c",
  restaurant: "#2b8a3e",
  break: "#0e9594",
  move: "#64748b",
  other: "#756a58",
  purchase: "#b45309",
  first10: "#0b7285",
};

// Short crowd-scenario words for the A/B/C switcher pills.
const SCENARIO_SHORT_LABELS: Record<SubTab, string> = {
  A: "劇混み",
  B: "混雑",
  C: "楽",
};

// Handle to the mounted map. selectPlace highlights a pin and
// centres the live map on that place (the map layer writes the two
// together so a render flushed between selection and pan cannot
// apply a stale centre); panTo centres the LIVE map on an arbitrary
// target (e.g. the viewer's own position) at the map layer's fixed
// focus zoom — the runtime cannot report the current zoom, so it
// cannot be preserved — and the map is never remounted to move it.
// panTo returns false only for an invalid target; callers still keep
// a one-shot retry as a safety net.
type MapController = {
  selectPlace?: (index: number) => void;
  panTo?: (target: { lat: number; lng: number }) => boolean;
  getZoom?: () => number | null;
  refreshSize?: () => void;
};

// Desktop horizontal scrolling for the overflow-x-auto tab strips.
// On touch devices the strips already scroll natively, and this hook
// deliberately ignores touch pointers so that behaviour is untouched.
// For mouse users it adds wheel + drag sideways scrolling.
function useDragScroll<T extends HTMLElement>(onDragStart?: () => void) {
  const ref = useRef<T | null>(null);
  const dragStartRef = useRef(onDragStart);
  dragStartRef.current = onDragStart;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const raw =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (raw === 0) return;
      const unit =
        e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
      const max = el.scrollWidth - el.clientWidth;
      const next = Math.min(max, Math.max(0, el.scrollLeft + raw * unit));
      if (next !== el.scrollLeft) {
        el.scrollLeft = next;
        e.preventDefault();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startScrollLeft = 0;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (el.scrollWidth <= el.clientWidth) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startScrollLeft = el.scrollLeft;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (!moved) {
        if (Math.abs(dx) < 5) return;
        moved = true;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* capture is best-effort; window-level moves still scroll */
        }
        el.classList.add("drag-scrolling");
        dragStartRef.current?.();
      }
      el.scrollLeft = startScrollLeft - dx;
      e.preventDefault();
    };
    const endDrag = () => {
      dragging = false;
      el.classList.remove("drag-scrolling");
    };
    const onClickCapture = (e: MouseEvent) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    };
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    el.addEventListener("click", onClickCapture, true);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", endDrag);
      el.removeEventListener("pointercancel", endDrag);
      el.removeEventListener("click", onClickCapture, true);
    };
  }, []);
  return ref;
}

// Spec-change suspicion （仕様変更の疑い）: an unverified entry
// concerns the app's premises about Disney's current system (DPA
// eligibility/prices, the normalized facts, park hours, show
// times, closures, ticket prices) — travel-leg entries （移動時間・
// 座標） do not count (a data gap, not a system change). Wherever
// such a detection is displayed, the display itself carries the
// repair guidance — the fix is asked of the owner's own Muse in
// the main chat, because the in-app AI cannot change the app.
const SPEC_SUSPECT_UNVERIFIED =
  /DPA|プレミアアクセス|ファクト|営業時間|公演時刻|休止|チケット/;
function hasSpecSuspectUnverified(unverified: string[]): boolean {
  return unverified.some(
    (u) => SPEC_SUSPECT_UNVERIFIED.test(u) && !/移動時間/.test(u),
  );
}

function SpecRepairNote() {
  return (
    <p className="mt-2 leading-relaxed">
      このアプリの前提が、現在のディズニーの仕様と合わなくなっている可能性があります。直す場合は、Museのメインのチャットで「現在のディズニーの仕様に合わせて、このアプリを直してください」と伝えてください。
    </p>
  );
}

// ---------------------------------------------------------------- map view

// ------------------------------------------------- static map fallback
//
// The interactive map comes from the virtual map library in
// map_helpers.mjs (the platform map component, MapLibre via
// hatch-maps). Only when the layer reports failure through
// onUnavailable — the platform map could not run at all — does
// PlanMap fall back to Meta's static map image of the same pinned
// places. It needs no worker and no WebGL, only an ordinary image
// load. The places are runtime data (each plan's own rows), so the
// image is requested at view time from the runtime coordinates via
// buildStaticMapUrl, framed on the pins' bounding box at the frame's
// real size. If even the image fails to load, PlanMap falls back to
// the text-only message. The viewer's own 現在地 is never included —
// only the plan's places are drawn.

// Web-Mercator projection for framing the static image.
function staticProjectX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * 256 * 2 ** zoom;
}
function staticProjectY(lat: number, zoom: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** zoom;
}
function staticUnprojectLat(y: number, zoom: number): number {
  const n = Math.PI * (1 - (2 * y) / (256 * 2 ** zoom));
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

// Centre + zoom fitting every point inside a w×h frame, with a
// margin so no pin sits on the frame's edge. A single distinct spot
// opens at park-detail zoom, like the interactive map's fit.
function staticMapFraming(
  points: { lat: number; lng: number }[],
  w: number,
  h: number,
): { center: [number, number]; zoom: number } {
  const distinct = new Set(points.map((p) => `${p.lat},${p.lng}`));
  let zoom = 16;
  if (distinct.size > 1) {
    zoom = 13;
    for (let z = 17; z >= 13; z--) {
      const xs = points.map((p) => staticProjectX(p.lng, z));
      const ys = points.map((p) => staticProjectY(p.lat, z));
      const spreadX = Math.max(...xs) - Math.min(...xs);
      const spreadY = Math.max(...ys) - Math.min(...ys);
      if (
        spreadX <= Math.max(120, w - 112) &&
        spreadY <= Math.max(120, h - 112)
      ) {
        zoom = z;
        break;
      }
    }
  }
  const xs = points.map((p) => staticProjectX(p.lng, zoom));
  const ys = points.map((p) => staticProjectY(p.lat, zoom));
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return {
    center: [
      staticUnprojectLat(cy, zoom),
      (cx / (256 * 2 ** zoom)) * 360 - 180,
    ],
    zoom,
  };
}

// An element's rendered size, tracked with a ResizeObserver, so the
// static map image can be requested at the frame's real size.
function useElementSize<T extends HTMLElement>() {
  const [size, setSize] = useState({ w: 880, h: 560 });
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w <= 0 || h <= 0) return;
      setSize((prev) =>
        Math.abs(prev.w - w) > 24 || Math.abs(prev.h - h) > 24
          ? { w, h }
          : prev,
      );
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(update);
      ro.observe(node);
      observerRef.current = ro;
    }
  }, []);
  return { ref, size };
}

function PlanMap({
  entries,
  mapKey,
  pinColor,
  rowRefs,
  controllerRef,
  onVisibilityChange,
}: {
  // One entry per timeline row, in display order. lat/lng null = no pin,
  // but the row still participates in list ordering.
  entries: Entry[];
  mapKey: string;
  pinColor?: string;
  // Reports the 地図表示 on/off state to the parent layout, which owns
  // the map cell's size: when off, the parent collapses the cell to
  // just the toggle button's height so the detail region below takes
  // over the freed space.
  onVisibilityChange?: (visible: boolean) => void;
  // The timeline rows rendered in the scrolling detail region below; the
  // map highlights and scrolls to them when a pin is selected.
  rowRefs: RefObject<(HTMLLIElement | null)[]>;
  // Shared handle so schedule-row taps can highlight the tapped pin and
  // smoothly pan the live map to it (zoom unchanged).
  controllerRef?: RefObject<MapController | null>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The live map layer handle, kept outside the mount effect so the
  // frame-size effect below can ask it to re-measure.
  const mapHandleRef = useRef<MapController | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // Static-image fallback: when the map layer reports the interactive
  // map unavailable, PlanMap shows Meta's static map image of the same
  // pins instead of only a text apology. staticImgFailed means even
  // that image could not be loaded; only then does the text-only
  // message appear. retryNonce re-runs the mount effect when the
  // viewer taps 「地図を再読み込み」 on the static image.
  const [staticImgFailed, setStaticImgFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const { ref: frameRef, size: frameSize } =
    useElementSize<HTMLDivElement>();
  useEffect(() => {
    setStaticImgFailed(false);
  }, [mapKey]);
  // Basemap toggle: 通常地図 vs 衛星地図, expressed engine-neutrally
  // ("standard" | "satellite") — which sources those names mean is
  // the map layer's business, not the app's.
  const [baseLayer, setBaseLayer] = useState<"standard" | "satellite">("standard");
  // 地図表示 on/off: when off, the map itself is not mounted at all —
  // only the toggle button remains, so the map can always be brought
  // back, AND the parent layout collapses the map cell to the button's
  // height (reported via onVisibilityChange), so the map's space
  // disappears with it and the list below expands. The state lives
  // here (not in the parent) so it survives A/B/C switches within the
  // same plan tab; toggling back on remounts the map via the mount
  // effect's dependency on this flag.
  const [mapVisible, setMapVisible] = useState(true);
  useEffect(() => {
    onVisibilityChange?.(mapVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapVisible]);

  // 現在地 (the viewer's own position): obtained only when the
  // 「現在地」 button is tapped, via the browser's Geolocation API —
  // never tracked continuously and never sent anywhere; the position
  // lives only in this component's state and is drawn on the map as a
  // blue dot overlay (see mountPlaceListMap). Whether the permission
  // prompt even reaches the page depends on the WebView the app runs
  // in (inside the Muse app it may be blocked); when the position
  // cannot be obtained the button says so in place instead of
  // pretending.
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
    accuracy: number | null;
  } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  // Set when a fresh position arrives: the map (re)mount effect below
  // pans to it once the new map is ready.
  const pendingPanRef = useRef(false);
  const userLocKey = userLocation
    ? `${userLocation.lat},${userLocation.lng}`
    : "";

  const handleLocate = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoMessage(
        "この端末・ブラウザでは位置情報を取得できませんでした。",
      );
      return;
    }
    setLocating(true);
    setGeoMessage(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const loc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy:
            typeof pos.coords.accuracy === "number" &&
            Number.isFinite(pos.coords.accuracy)
              ? pos.coords.accuracy
              : null,
        };
        const sameSpot =
          userLocation != null &&
          userLocation.lat === loc.lat &&
          userLocation.lng === loc.lng;
        setUserLocation(loc);
        if (sameSpot) {
          // No remount follows (the dot is already there): pan on the
          // live map directly, with the usual one retry while the map
          // is still initialising.
          const target = { lat: loc.lat, lng: loc.lng };
          let panned = false;
          try {
            panned = controllerRef?.current?.panTo?.(target) ?? false;
          } catch {
            panned = false;
          }
          if (!panned) {
            window.setTimeout(() => {
              try {
                controllerRef?.current?.panTo?.(target);
              } catch {
                /* pan is best-effort */
              }
            }, 350);
          }
        } else {
          // The mount effect re-creates the map with the dot overlay
          // and pans to it (pendingPanRef).
          pendingPanRef.current = true;
        }
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGeoMessage(
            "位置情報の許可がありませんでした。端末の設定で位置情報を許可すると現在地を表示できます。アプリ内では取得できない場合もあります。",
          );
        } else if (err.code === err.TIMEOUT) {
          setGeoMessage(
            "現在地の取得に時間がかかり、取得できませんでした。もう一度お試しください。",
          );
        } else {
          setGeoMessage("現在地を取得できませんでした。");
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  const pinned = entries.filter((e) => e.item.lat != null && e.item.lng != null);
  // Indices (into `entries`) of pinned rows, so pin numbers match row numbers.
  const pinnedEntryIdx = entries
    .map((e, i) => (e.item.lat != null && e.item.lng != null ? i : -1))
    .filter((i) => i >= 0);

  useEffect(() => {
    setUnavailable(false);
    const el = containerRef.current;
    // 地図表示 off: the map container is not rendered at all, so
    // there is nothing to mount into; the previous run's cleanup has
    // already destroyed the old map.
    if (!el || pinned.length === 0 || !mapVisible) return;
    const rows = pinnedEntryIdx
      .map((i) => rowRefs.current[i])
      .filter((r): r is HTMLLIElement => r != null);
    const places = pinned.map((e) => ({
      label: e.item.facilityName,
      lat: e.item.lat as number,
      lng: e.item.lng as number,
    }));
    // The layer's handle teardown is destroy(). Calling it here is
    // what makes the basemap toggle work: without it the previous
    // basemap stays mounted on the same container and the new layer
    // never becomes visible.
    let map: MapController | null = null;
    try {
      map = mountPlaceListMap(
        el,
        {
          places,
          rows,
          baseLayer,
          ...(userLocation
            ? {
                userLocation: {
                  lat: userLocation.lat,
                  lng: userLocation.lng,
                },
              }
            : {}),
        },
        () => setUnavailable(true),
      ) as MapController | null;
      mapHandleRef.current = map;
      if (controllerRef) {
        controllerRef.current = map;
      }
    } catch {
      setUnavailable(true);
    }
    // Both map engines put their attribution control in the map's
    // bottom-RIGHT corner, which is where the owner wants it —
    // directly above the 現在地 button that occupies the corner's
    // bottom edge. Neither engine exposes an offset option for it,
    // so theme.css lifts the whole bottom-right control corner up by
    // the button's height (the `.plan-map` rules); no DOM relocation
    // happens here.
    // A fresh 現在地 position remounts the map (the dot overlay is
    // part of the mount options); once mounted, centre on the viewer.
    // The pan is issued on a short ladder as a safety net, in case
    // the first call lands before the new map's first render — the
    // same pattern row taps use.
    let panTimers: number[] = [];
    if (pendingPanRef.current && userLocation) {
      pendingPanRef.current = false;
      const target = { lat: userLocation.lat, lng: userLocation.lng };
      panTimers = [350, 900].map((delay) =>
        window.setTimeout(() => {
          try {
            map?.panTo?.(target);
          } catch {
            /* pan is best-effort */
          }
        }, delay),
      );
    }
    return () => {
      panTimers.forEach((t) => window.clearTimeout(t));
      mapHandleRef.current = null;
      if (controllerRef) controllerRef.current = null;
      try {
        (map as { destroy?: () => void } | null)?.destroy?.();
        (map as { remove?: () => void } | null)?.remove?.();
      } catch {
        /* map already gone */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey, baseLayer, userLocKey, mapVisible, retryNonce]);

  // Keep the map's internal size in step with its frame. The frame
  // changes size whenever content appears or disappears in the
  // banner row above it and when the window itself resizes; the
  // map renders for the size it last measured, so an untold change
  // can leave it laid out for a size the container no longer has.
  // frameSize already tracks the frame through a ResizeObserver
  // (it feeds the static fallback's framing); every real change now
  // also asks the live map to re-measure and re-render at the true
  // size. The first run after a mount is a no-op settle (the
  // handle is set by the mount effect, which runs first).
  const frameSizeRef = useRef(frameSize);
  useEffect(() => {
    const prev = frameSizeRef.current;
    frameSizeRef.current = frameSize;
    if (prev.w === frameSize.w && prev.h === frameSize.h) return;
    try {
      mapHandleRef.current?.refreshSize?.();
    } catch {
      /* size refresh is best-effort */
    }
  }, [frameSize]);

  // 地図表示 on/off toggle: with the map on it overlays the map's
  // TOP-LEFT; with the map off it renders in normal flow as the ONLY
  // content of the (now collapsed) map cell — it must never disappear
  // while the map is off: it is the only way back.
  const renderVisibilityToggle = (floating: boolean) => (
    <button
      type="button"
      onClick={() => setMapVisible((v) => !v)}
      aria-pressed={mapVisible}
      aria-label="地図表示のオン・オフ"
      className={`${floating ? "absolute left-2 top-2" : ""} z-20 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold shadow-md ${
        mapVisible
          ? "bg-[var(--surface)] text-[var(--text)]"
          : "bg-[var(--text)] text-[var(--bg)]"
      }`}
    >
      地図表示 {mapVisible ? "ON" : "OFF"}
    </button>
  );
  const visibilityToggle = renderVisibilityToggle(true);

  if (!mapVisible) {
    // Nothing but the toggle: no placeholder frame, no "非表示です"
    // panel — the parent has collapsed this cell to the button's own
    // height, so the button alone is the whole off state.
    return (
      <div className="flex justify-start">{renderVisibilityToggle(false)}</div>
    );
  }
  if (pinned.length === 0 || (unavailable && staticImgFailed)) {
    return (
      <p className="rounded-[var(--radius)] border border-dashed border-[var(--border)] px-3 py-2 text-sm text-[var(--dim)]">
        {pinned.length === 0
          ? "このプランでは地図ピンの座標を取得できませんでした。下のリストで順番を確認してください。"
          : "地図を表示できませんでした。下のリストで順番を確認してください。"}
      </p>
    );
  }
  if (unavailable) {
    // Static fallback: a still map of the same pins, framed on their
    // bounding box at the frame's real size, with the map notices
    // link under it. Static pins carry no numbers — the caption says
    // so, and the numbered list below remains the order reference.
    // The basemap toggle and 現在地 button belong to the live map
    // and are not shown here; 「地図を再読み込み」 retries the
    // interactive map once.
    const points = pinned.map((e) => ({
      lat: e.item.lat as number,
      lng: e.item.lng as number,
    }));
    const imgW = Math.min(1200, Math.max(320, frameSize.w));
    const imgH = Math.min(900, Math.max(240, frameSize.h));
    const framing = staticMapFraming(points, imgW, imgH);
    const staticUrl = buildStaticMapUrl({
      center: framing.center,
      zoom: framing.zoom,
      width: imgW,
      height: imgH,
      scale: 2,
      markers: points
        .slice(0, 40)
        .map((p) => ({ position: [p.lat, p.lng] as [number, number] })),
    });
    return (
      <div className="flex h-full w-full flex-col">
        <div
          ref={frameRef}
          className="plan-map relative min-h-0 w-full flex-1 overflow-hidden rounded-[var(--radius)] border border-[var(--border)]"
        >
          {visibilityToggle}
          <img
            src={staticUrl}
            alt="プランの地図（静止画）。ピンは下のリストにある場所の位置を示します"
            className="h-full w-full object-cover"
            onError={() => setStaticImgFailed(true)}
          />
          <span className="absolute bottom-2 left-2 z-10 max-w-[70%] rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold shadow-md">
            静止画の地図です（ピンは場所の位置のみ・番号なし）
          </span>
          <button
            type="button"
            onClick={() => {
              setStaticImgFailed(false);
              setUnavailable(false);
              setRetryNonce((n) => n + 1);
            }}
            aria-label="対話式の地図を再読み込み"
            className="absolute bottom-2 right-2 z-10 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text)] shadow-md"
          >
            地図を再読み込み
          </button>
        </div>
        <p className="shrink-0 pt-1 text-right text-[11px] leading-tight">
          <a
            href="https://www.facebook.com/maps/attribution_terms"
            target="_blank"
            rel="noopener"
            className="text-[var(--dim)] underline"
          >
            © OpenStreetMap contributors, Map Data Legal Notices
          </a>
        </p>
      </div>
    );
  }
  return (
    <div ref={frameRef} className="relative h-full w-full">
      {visibilityToggle}
      <div
        ref={containerRef}
        role="img"
        aria-label="プランの地図。番号ピンが回る順番を示します"
        style={pinColor ? ({ "--pin-color": pinColor } as CSSProperties) : undefined}
        className="plan-map h-full w-full overflow-hidden rounded-[var(--radius)] border border-[var(--border)]"
      />
      <div
        role="group"
        aria-label="地図の種類切替"
        className="absolute bottom-2 left-2 z-10 flex overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold shadow-md"
      >
        {(
          [
            { key: "standard", label: "通常地図" },
            { key: "satellite", label: "衛星地図" },
          ] as const
        ).map((b) => (
          <button
            key={b.key}
            aria-pressed={baseLayer === b.key}
            onClick={() => setBaseLayer(b.key)}
            className={`px-3 py-1.5 ${
              baseLayer === b.key
                ? "bg-[var(--text)] text-[var(--bg)]"
                : "text-[var(--dim)]"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>
      {/* 現在地 button: bottom-right, with the map's copyright
          attribution directly above it (theme.css lifts the
          attribution corner by this button's height). One tap = one
          position fix; the map centres on the blue dot. While a fix
          is in flight the button is disabled and says so. */}
      <button
        type="button"
        onClick={handleLocate}
        disabled={locating}
        aria-pressed={userLocation != null}
        aria-label="現在地を表示"
        className={`absolute bottom-2 right-2 z-10 flex items-center gap-1.5 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-semibold shadow-md ${
          userLocation != null
            ? "bg-[#2f6fd0] text-white"
            : "bg-[var(--surface)] text-[var(--text)]"
        } ${locating ? "opacity-70" : ""}`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
        {locating ? "取得中…" : "現在地"}
      </button>
      {geoMessage ? (
        // Raised above the bottom edge so the message never covers
        // the 現在地 button it asks the viewer to retry, nor the
        // basemap toggle at the bottom-left.
        <p
          role="alert"
          className="absolute bottom-14 left-2 right-2 z-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs leading-relaxed shadow-md"
        >
          {geoMessage}
        </p>
      ) : userLocation ? (
        // Bottom-left, raised above the basemap toggle that now
        // occupies that corner's bottom edge.
        <p className="absolute bottom-12 left-2 z-10 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-semibold shadow-md">
          現在地を表示しています
          {userLocation.accuracy != null
            ? `（精度 約${Math.max(1, Math.round(userLocation.accuracy))}m）`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- rows

// Row-level unconfirmed mark: a row that places a value which could
// not be confirmed from official sources carries the mark
// 「未確定（理由）」 with its short reason, visually distinct from a
// confirmed row (dashed amber outline). Tapping the reason toggles
// the explanation. The tap must not trigger the row's own tap
// behaviour (map pan), so it stops propagation.
function UnconfirmedMark({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  if (!row.uncertain) return null;
  const reason = row.uncertainReason ?? "理由";
  return (
    <div className="mt-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`未確定（${reason}）。押すと説明を表示します`}
        onClick={(ev) => {
          ev.stopPropagation();
          setOpen((o) => !o);
        }}
        className="rounded-full border border-dashed border-amber-600 bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-100"
      >
        未確定（{reason}）
      </button>
      {open ? (
        <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-sm leading-relaxed text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          公式情報ではまだ確定していない要素です。確定情報が出たら、プランの作り直しで反映できます。
        </p>
      ) : null}
    </div>
  );
}

function RowList({
  entries,
  rowRefs,
  showPinNumbers,
  onRowTap,
}: {
  entries: Entry[];
  rowRefs?: RefObject<(HTMLLIElement | null)[]>;
  showPinNumbers?: boolean;
  // Called with the entry index when a row is tapped; the parent centres
  // the map on that row's place (rows without coordinates ignore it).
  onRowTap?: (index: number) => void;
}) {
  const setRef = (i: number) =>
    rowRefs
      ? (el: HTMLLIElement | null) => {
          rowRefs.current[i] = el;
        }
      : undefined;
  const pinNumber = (i: number): number =>
    entries.slice(0, i + 1).filter((x) => x.item.lat != null && x.item.lng != null).length;
  return (
    <ol className="mt-3 space-y-2">
      {entries.map((e, i) => {
        const item = e.item;
        // A stored purchase-event row renders as its purchase event
        // card: a solid accent frame, its purchase time leading.
        if (item.kind === "purchase") {
          return (
            <li
              key={item.id}
              ref={setRef(i)}
              onClick={() => onRowTap?.(i)}
              className="flex gap-3 rounded-[var(--radius)] border-2 border-[var(--accent)] bg-[var(--surface)] px-3 py-2.5"
            >
              <div className="flex w-[52px] shrink-0 flex-col items-start">
                <span className="text-base font-bold leading-tight tabular-nums">
                  {item.purchaseTime ?? item.startTime ?? ""}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                {/* The purchase row occupies a numbered pin like any
                    other pinned row (its coordinates come from the
                    target facility), so it carries the same pin-number
                    badge as a regular row — the 🛒 marks the purchase,
                    the number keeps the row↔pin correspondence. */}
                <p className="flex items-start gap-1.5 text-sm font-bold leading-snug">
                  {showPinNumbers && item.lat != null && item.lng != null ? (
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ background: e.color }}
                    >
                      {pinNumber(i)}
                    </span>
                  ) : null}
                  <span className="min-w-0">
                    🛒 DPA購入：{item.facilityName}
                    {item.price != null ? ` ${item.price.toLocaleString("ja-JP")}円` : ""}
                    {item.targetCount != null ? ` × ${item.targetCount}人` : ""}
                  </span>
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
                  購入は1回に1枚だけ。買えなかったら、その後の予定の組み直しが必要になる分岐点です。
                </p>
                <UnconfirmedMark row={item} />
                {item.note ? (
                  <p className="mt-1 text-sm leading-relaxed">{item.note}</p>
                ) : null}
              </div>
            </li>
          );
        }
        // The 「最初の10分」 block (kind "first10") is display-only
        // content: a heading, the first tasks as a bullet list, and
        // the remaining guidance lines. Its note carries the parts
        // one per line — bullets start with 「・」.
        if (item.kind === "first10") {
          const lines = (item.note ?? "")
            .split(/\n+/)
            .map((s) => s.trim())
            .filter(Boolean);
          const bullets = lines
            .filter((l) => l.startsWith("・"))
            .map((l) => l.replace(/^・\s*/, ""));
          const rest = lines.filter((l) => !l.startsWith("・"));
          return (
            <li
              key={item.id}
              ref={setRef(i)}
              className="rounded-[var(--radius)] border-2 bg-[var(--surface)] px-3 py-2.5"
              style={{ borderColor: KIND_COLORS["first10"] }}
            >
              <div className="flex gap-3">
                <div className="flex w-[52px] shrink-0 flex-col items-start">
                  <span className="text-base font-bold leading-tight tabular-nums">
                    {item.startTime ?? ""}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-base font-bold leading-snug">
                    {item.facilityName || "入園後の最初の10分"}
                  </p>
                  {bullets.length > 0 ? (
                    <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
                      {bullets.map((b, bi) => (
                        <li key={bi} className="text-sm leading-relaxed">
                          {b}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {rest.map((line, liIdx) => (
                    <p
                      key={liIdx}
                      className="mt-2 text-sm leading-relaxed text-[var(--dim)]"
                    >
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            </li>
          );
        }
        // A move row IS the movement: it renders as the centred
        // travel divider, with the server-computed minutes (and the
        // walking distance when known).
        if (item.kind === "move") {
          return (
            <li
              key={item.id}
              ref={setRef(i)}
              className="flex justify-center py-0.5"
            >
              <span className="rounded-full bg-[var(--surface-alt)] px-3 py-1 text-xs font-semibold text-[var(--dim)]">
                移動 約{item.moveMinutes ?? "―"}分
                {item.walkM != null
                  ? `（歩行距離 約${item.walkM.toLocaleString("ja-JP")}m）`
                  : ""}
                {item.note ? `　${item.note}` : ""}
              </span>
            </li>
          );
        }
        const title = item.facilityName || item.note || KIND_LABELS[item.kind] || item.kind;
        return (
          <li
            key={item.id}
            ref={setRef(i)}
            onClick={() => onRowTap?.(i)}
            className={`flex gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5${
              item.lat != null && item.lng != null ? " cursor-pointer" : ""
            }`}
          >
            {/* Transit-guide layout: the time leads the row, large and
                first. The route pin number sits before the title (below). */}
            <div className="flex w-[52px] shrink-0 flex-col items-start">
              <span className="text-base font-bold leading-tight tabular-nums">
                {item.startTime ?? ""}
              </span>
              <span
                aria-hidden
                className="mt-2 h-2.5 w-2.5 rounded-full"
                style={{ background: e.color }}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-start gap-1.5 text-base font-semibold leading-snug">
                {showPinNumbers && item.lat != null && item.lng != null ? (
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ background: e.color }}
                  >
                    {pinNumber(i)}
                  </span>
                ) : null}
                <span className="min-w-0">{title}</span>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--dim)]">
                <span
                  className="rounded-full px-2 py-0.5 font-semibold text-white"
                  style={{ background: KIND_COLORS[item.kind] ?? KIND_COLORS["other"] }}
                >
                  {KIND_LABELS[item.kind] ?? item.kind}
                </span>
              </p>
              <UnconfirmedMark row={item} />
              {item.note && item.facilityName ? (
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{item.note}</p>
              ) : null}
              {item.officialUrl ? (
                <p className="mt-1.5">
                  <a
                    href={item.officialUrl}
                    target="_blank"
                    rel="noopener"
                    onClick={(ev) => ev.stopPropagation()}
                    aria-label={`${title}の公式ページを開く`}
                    className="text-sm font-semibold text-[var(--accent)] underline underline-offset-2"
                  >
                    公式ページ
                  </a>
                </p>
              ) : null}
            </div>
            {/* The estimated wait is the single most important number on
                the row: it sits at the right end, large, as row data —
                never buried in the note text. Shown for 0 minutes too.
                Restaurant rows never carry a wait. */}
            {item.kind !== "restaurant" && item.waitMinutes != null ? (
              <div className="flex w-[68px] shrink-0 flex-col items-end justify-start pt-0.5 text-right">
                <span className="text-[11px] font-semibold leading-none text-[var(--dim)]">
                  推定待ち
                </span>
                <span
                  className={`mt-1 text-3xl font-bold leading-none tabular-nums${
                    item.waitMinutes >= 60 ? " text-[var(--accent)]" : ""
                  }`}
                >
                  {item.waitMinutes}
                  <span className="text-base font-bold">分</span>
                </span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// ------------------------------------------------------- plan progress

// The stuck-generation safeguard: under every progress display — and
// only while a generation is in flight — the elapsed time since the
// run started, the fixed note below, and リトライ / キャンセル
// buttons. The clock counts from the start timestamp the SERVER
// recorded for the run, so reloading the page never resets it; the
// one-second tick only re-renders the difference. Both buttons call
// server actions that never involve the possibly-dead generation
// task itself.
const GENERATION_ESCAPE_NOTE =
  "通常は遅くても20分以内で作成されます。遅すぎる場合はMuseが固まってる可能性があります。その場合、キャンセルかリトライボタンを押してください。";

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}時間${m}分${s}秒` : `${m}分${s}秒`;
}

// The once-a-minute report lines: what the generation is doing, one
// plain-words line per minute, written on the server's clock and
// carried in the state — this list only renders them, oldest first,
// each with its time.
function GenerationReportLines({
  lines,
}: {
  lines: { at: number; text: string }[];
}) {
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-1">
      {lines.map((l, i) => {
        const d = new Date(l.at);
        const clock = Number.isNaN(d.getTime())
          ? ""
          : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        return (
          <li key={i} className="flex gap-2 text-sm leading-relaxed">
            {clock ? (
              <span className="shrink-0 tabular-nums text-[var(--dim)]">
                {clock}
              </span>
            ) : null}
            <span>{l.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

function GenerationEscapeBlock({
  setId,
  startedAt,
  centered = false,
  reportLines,
}: {
  setId: number;
  startedAt: number | null;
  centered?: boolean;
  reportLines?: { at: number; text: string }[];
}) {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const retryMutation = useMutation({
    mutationFn: async () => await api.retrySet({ setId }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const cancelMutation = useMutation({
    mutationFn: async () => await api.cancelSet({ setId }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const busy = retryMutation.isPending || cancelMutation.isPending;
  const error =
    retryMutation.isError || cancelMutation.isError
      ? "操作できませんでした。少し待ってもう一度お試しください。"
      : null;
  return (
    <div
      className={
        centered
          ? "mx-auto mt-6 max-w-md space-y-2.5 text-left"
          : "mt-3 space-y-2.5 text-left"
      }
    >
      {reportLines && reportLines.length > 0 ? (
        <GenerationReportLines lines={reportLines} />
      ) : null}
      {startedAt != null ? (
        <p className="text-sm font-semibold">
          経過時間：{formatElapsed(now - startedAt)}
        </p>
      ) : null}
      <p className="text-sm leading-relaxed text-[var(--dim)]">
        {GENERATION_ESCAPE_NOTE}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => retryMutation.mutate()}
          disabled={busy}
          className="rounded-full bg-[var(--accent)] px-5 py-1.5 text-sm font-bold text-[var(--accent-text)] disabled:opacity-50"
        >
          リトライ
        </button>
        <button
          type="button"
          onClick={() => cancelMutation.mutate()}
          disabled={busy}
          className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-1.5 text-sm font-bold text-red-700 disabled:opacity-50 dark:text-red-300"
        >
          キャンセル
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// A failed plan set's リトライ button: the set stands at 失敗 and
// retrySet re-runs the whole generation on the SAME set from its
// recorded conditions.
function FailedSetRetryBlock({ setId }: { setId: number }) {
  const queryClient = useQueryClient();
  const retryMutation = useMutation({
    mutationFn: async () => await api.retrySet({ setId }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const error = retryMutation.isError
    ? "操作できませんでした。少し待ってもう一度お試しください。"
    : null;
  return (
    <div className="mt-4 space-y-2.5">
      <button
        type="button"
        onClick={() => retryMutation.mutate()}
        disabled={retryMutation.isPending}
        className="rounded-full bg-[var(--accent)] px-5 py-1.5 text-sm font-bold text-[var(--accent-text)] disabled:opacity-50"
      >
        リトライ
      </button>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------- set conditions

const WALK_SPEED_LABELS: Record<number, string> = {
  55: "ゆっくり",
  70: "少しゆっくり",
  85: "少し急いで",
  100: "急いで",
};

function formatVisitDateLabel(v: string | null): string {
  if (!v) return "未定";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return v;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

function CondRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3 py-1">
      <dt className="w-24 shrink-0 text-[var(--dim)]">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

// The 「条件」 panel: the search conditions THIS plan set was
// generated under, from the set's own stored conditions snapshot —
// never the live プラン作成 form, which may have been edited since.
// The conditions are shared by A/B/C, so the panel belongs to the
// set, not to a plan.
function SetConditionsPanel({ condition }: { condition: Condition }) {
  const c = condition;
  return (
    <div className="mx-4 mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3">
      <p className="text-sm font-bold">このプランの検索条件</p>
      <dl className="mt-1 text-sm leading-relaxed">
        <CondRow label="パーク">
          {c.park === "land" ? "東京ディズニーランド" : "東京ディズニーシー"}
        </CondRow>
        <CondRow label="日付">{formatVisitDateLabel(c.visitDate)}</CondRow>
        <CondRow label="入園〜退園">
          {`${c.entryTime ?? "未定"} 〜 ${c.exitTime ?? "未定"}`}
        </CondRow>
        <CondRow label="予算">
          {`${c.budget.toLocaleString("ja-JP")}円`}
        </CondRow>
        <CondRow label="人数">
          {`大人${c.adults}人・子ども${c.children.length}人${
            c.children.length > 0
              ? `（${c.children
                  .map(
                    (k) =>
                      `${k.age}歳${k.heightCm != null ? `・${k.heightCm}cm` : ""}`,
                  )
                  .join("、")}）`
              : ""
          }`}
        </CondRow>
        <CondRow label="重視する点">
          <span className="whitespace-pre-line">{c.priority || "未入力"}</span>
        </CondRow>
        <CondRow label="歩く速さ">
          {WALK_SPEED_LABELS[c.walkSpeed] ?? `${c.walkSpeed}m／分`}
        </CondRow>
      </dl>
    </div>
  );
}

// ------------------------------------------------------- plan summary

// "12時間" / "6時間30分" style label for the summary's 滞在時間.
function formatStayDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

function formatWalkDistance(m: number): string {
  if (m >= 1000) return `約${(Math.round(m / 100) / 10).toLocaleString("ja-JP")}km`;
  return `約${m.toLocaleString("ja-JP")}m`;
}

function toMinutes(label: string | null): number | null {
  if (!label) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(label);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

// One statistic card of the plan-head summary: a small label, one
// large bold number, and optional small sub-lines. `small` is the
// third row's compact variant （ショー／パレード／レストラン）.
function StatCard({
  label,
  value,
  sub,
  small,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  small?: boolean;
}) {
  return (
    <div className="rounded-lg bg-[var(--surface)] px-2.5 py-2.5">
      <p className="text-[11px] font-semibold leading-tight text-[var(--dim)]">
        {label}
      </p>
      <p
        className={`mt-0.5 font-display font-bold leading-tight ${
          small ? "text-lg" : "text-2xl"
        }`}
      >
        {value}
      </p>
      {sub ? (
        <div className="mt-1 space-y-0.5 text-[11px] leading-snug text-[var(--dim)]">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

// The plan-head summary （サマリー見出し）: the executive summary at
// the very head of each plan, directly under its title — the one
// place in this app where the numbers are shown big. Every value is
// derived here from the plan's own stored data (total, breakdown,
// rows, and the set's conditions), so switching A/B/C switches the
// whole summary with the plan. Row order: 1) 費用概算／アトラク
// ション／待ち時間合計， 2) 移動時間合計／歩行距離概算／滞在時間，
// 3) ショー／パレード／レストラン (small), 4) an amber 未確認 band,
// ONLY when the plan actually has unconfirmed rows.
function PlanSummaryStats({
  plan,
  condition,
}: {
  plan: Plan;
  condition: Condition;
}) {
  const rows = plan.rows;
  const yen = (n: number): string => `¥${n.toLocaleString("ja-JP")}`;
  const purchaseRows = rows.filter((r) => r.kind === "purchase");
  const attractionRows = rows.filter((r) => r.kind === "attraction");
  const attractionNames = new Set(attractionRows.map((r) => r.facilityName));
  const attractionDpaCount = purchaseRows.filter((r) =>
    attractionNames.has(r.facilityName),
  ).length;
  const attractionDpaRatePct =
    attractionRows.length > 0
      ? Math.round((attractionDpaCount / attractionRows.length) * 100)
      : null;
  const waitRows = rows.filter((r) => r.waitMinutes != null);
  const totalWaitMin = waitRows.reduce((sum, r) => sum + (r.waitMinutes ?? 0), 0);
  const longestWait = waitRows.reduce<{ name: string; waitMin: number } | null>(
    (best, r) =>
      r.waitMinutes != null && (best == null || r.waitMinutes > best.waitMin)
        ? { name: r.facilityName || r.note, waitMin: r.waitMinutes }
        : best,
    null,
  );
  const entryMin = toMinutes(condition.entryTime);
  const exitMin = toMinutes(condition.exitTime);
  const stayMinutes =
    entryMin != null && exitMin != null && exitMin > entryMin
      ? exitMin - entryMin
      : null;
  const unconfirmed = rows.filter((r) => r.uncertain);
  const budgetDiff = condition.budget - plan.total;
  return (
    <div className="mt-3">
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          label="費用概算"
          value={
            <>
              {plan.total.toLocaleString("ja-JP")}
              <span className="ml-0.5 text-xs font-semibold">円</span>
            </>
          }
          sub={
            <>
              <p>
                うちDPA {yen(plan.breakdown.dpa)}・{purchaseRows.length}件
              </p>
              <p>
                予算 {yen(condition.budget)}
                {budgetDiff >= 0
                  ? `（残り ${yen(budgetDiff)}）`
                  : `（${(-budgetDiff).toLocaleString("ja-JP")}円超過）`}
              </p>
            </>
          }
        />
        <StatCard
          label="アトラクション"
          value={
            <>
              {attractionRows.length}
              <span className="ml-0.5 text-xs font-semibold">件</span>
            </>
          }
          sub={
            <>
              <p>うちDPA {attractionDpaCount}件</p>
              {attractionDpaRatePct != null ? (
                <p>DPA率 {attractionDpaRatePct}%</p>
              ) : null}
            </>
          }
        />
        <StatCard
          label="待ち時間合計"
          value={
            <>
              {totalWaitMin}
              <span className="ml-0.5 text-xs font-semibold">分</span>
            </>
          }
          sub={
            longestWait ? (
              <p>
                最長：{longestWait.name} {longestWait.waitMin}分
              </p>
            ) : null
          }
        />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <StatCard
          label="移動時間合計"
          value={
            <>
              {plan.moveTotal}
              <span className="ml-0.5 text-xs font-semibold">分</span>
            </>
          }
        />
        <StatCard
          label="歩行距離概算"
          value={formatWalkDistance(plan.walkTotal)}
        />
        <StatCard
          label="滞在時間"
          value={stayMinutes != null ? formatStayDuration(stayMinutes) : "―"}
          sub={
            condition.entryTime && condition.exitTime ? (
              <p>
                {condition.entryTime}〜{condition.exitTime}
              </p>
            ) : null
          }
        />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <StatCard
          small
          label="ショー"
          value={
            <>
              {rows.filter((r) => r.kind === "show").length}
              <span className="ml-0.5 text-[11px] font-semibold">件</span>
            </>
          }
        />
        <StatCard
          small
          label="パレード"
          value={
            <>
              {rows.filter((r) => r.kind === "parade").length}
              <span className="ml-0.5 text-[11px] font-semibold">件</span>
            </>
          }
        />
        <StatCard
          small
          label="レストラン"
          value={
            <>
              {rows.filter((r) => r.kind === "restaurant").length}
              <span className="ml-0.5 text-[11px] font-semibold">件</span>
            </>
          }
        />
      </div>
      {unconfirmed.length > 0 ? (
        <div className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-sm leading-relaxed text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <span className="font-semibold">未確認{unconfirmed.length}件：</span>
          {unconfirmed
            .map(
              (u) =>
                `${u.facilityName || u.note}（${u.uncertainReason ?? "理由"}）`,
            )
            .join("、")}
        </div>
      ) : null}
    </div>
  );
}

// Plan name + cost, shown first under the map: the total, then the
// itemized breakdown lines （チケット / DPA / 食事 / その他） from
// the plan's stored breakdown. Directly under the title (inside
// this header card) the plan's premise is shown: the single
// 「重視する点」 (shared by all three plans) plus THIS plan's crowd
// scenario premise — both from the set's stored conditions snapshot
// / plan row, what the user actually entered for THIS run, not the
// current form values.
function PlanCostHeader({
  plan,
  condition,
}: {
  plan: Plan;
  condition: Condition;
}) {
  const slot = (["A", "B", "C"].includes(plan.slot) ? plan.slot : "A") as SubTab;
  // Stored plan titles may already carry the 「プランX：」 prefix, so
  // strip it before composing the heading — otherwise the heading
  // reads 「プランA：プランA：…」.
  const cleanTitle = plan.title.replace(/^プラン[ABC][:：]\s*/, "");
  const bd = plan.breakdown;
  const costLines: { label: string; amount: number; note?: string }[] = [
    { label: "チケット", amount: bd.ticket },
    { label: "DPA", amount: bd.dpa, note: bd.dpaDetail || undefined },
    { label: "食事", amount: bd.food },
    { label: "その他", amount: bd.other },
  ];
  return (
    <div className="mt-3 rounded-[var(--radius)] bg-[var(--surface-alt)] px-3.5 py-3">
      <p className="font-display text-base font-bold">
        <span
          aria-hidden
          className="mr-2 inline-block h-3 w-3 rounded-full align-baseline"
          style={{ background: PLAN_COLORS[slot] }}
        />
        プラン{slot}：{cleanTitle}
      </p>
      {/* The summary headline sits directly under the plan title,
          before the schedule and the cost breakdown. */}
      <PlanSummaryStats plan={plan} condition={condition} />
      <div className="mt-2">
        <p className="text-sm font-semibold">
          概算費用（合計）: 約{plan.total.toLocaleString("ja-JP")}円
        </p>
        <dl className="mt-1.5 space-y-1">
          {costLines.map((line, i) => (
            <div
              key={i}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <dt className="shrink-0 whitespace-nowrap text-[var(--dim)]">{line.label}</dt>
              <dd className="text-right">
                {`${line.amount.toLocaleString("ja-JP")}円`}
                {line.note ? (
                  <span className="text-[var(--dim)]">（{line.note}）</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {plan.scenario || condition.priority ? (
        <div className="mt-3 border-t border-[var(--border)] pt-2.5">
          <p className="text-xs font-semibold text-[var(--dim)]">
            このプランの前提
          </p>
          {plan.scenario ? (
            <p className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-relaxed">
              {plan.scenario}
            </p>
          ) : null}
          {condition.priority ? (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
              <span className="font-semibold">重視する点：</span>
              {condition.priority}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// The verification record stored with the set (the save-time gate's
// record, as JSON text): the unconfirmed list made readable, plus a
// spec-change repair note when an unconfirmed entry concerns the
// app's premises about Disney's current system.
function VerificationRecord({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false);
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  const unconfirmed =
    parsed && Array.isArray(parsed["unconfirmed"])
      ? (parsed["unconfirmed"] as string[])
      : [];
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="font-semibold text-[var(--accent)]"
      >
        検証の記録{open ? "（閉じる）" : "（開く）"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-sm leading-relaxed">
          {unconfirmed.length > 0 && (
            <div className="rounded-lg bg-amber-100 px-3 py-2 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <p className="font-semibold">未確認の項目があります</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {unconfirmed.map((u, i) => (
                  <li key={i}>未確認：{u}</li>
                ))}
              </ul>
              {hasSpecSuspectUnverified(unconfirmed) ? (
                <SpecRepairNote />
              ) : null}
            </div>
          )}
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-[var(--surface)] p-2 text-xs">
            {JSON.stringify(parsed, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- plan tab

export function PlanSetView({
  setId,
  startedAt,
  progress,
  onDeleted,
  selectedSlot,
  onSelectSlot,
}: {
  setId: number;
  startedAt: number | null;
  progress: { at: number; text: string }[];
  onDeleted: () => void;
  // The selected slot lives in the App shell (per plan set), so a
  // message sent from the bottom form can report which plan the user
  // is looking at in this tab. null = the 「条件」 panel is selected.
  selectedSlot: SubTab | null;
  onSelectSlot: (slot: SubTab | null) => void;
}) {
  const queryClient = useQueryClient();
  const showConditions = selectedSlot === null;
  const sub: SubTab = selectedSlot ?? "A";
  const [detailTab, setDetailTab] = useState<"schedule" | "about" | "crowd">(
    "schedule",
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 地図表示 off, as reported by PlanMap's toggle: the map cell below
  // collapses to just the toggle button's height so the detail region
  // takes over the freed space.
  const [mapOff, setMapOff] = useState(false);
  const handleMapVisibilityChange = useCallback((visible: boolean) => {
    setMapOff(!visible);
  }, []);
  // Timeline row elements in the scrolling detail region, shared with the
  // fixed map so pin selection can highlight/scroll to the matching row.
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  // Desktop drag/wheel sideways scrolling for the A/B/C sub-tab strip
  // (same treatment as the main tab bar).
  const subTabBarRef = useDragScroll<HTMLDivElement>();
  // Handle to the mounted map so a schedule-row tap can highlight its
  // pin and smoothly pan the live map to it.
  const mapControllerRef = useRef<MapController | null>(null);

  const detail = useQuery({
    queryKey: ["planSet", setId],
    queryFn: () => api.getPlanSet({ setId }),
    refetchInterval: (q) => (q.state.data?.set?.status === "creating" ? 15000 : false),
  });
  const del = useMutation({
    mutationFn: async () => await api.deletePlanSet({ setId }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      onDeleted();
    },
  });

  if (detail.isPending) {
    return <p className="px-4 py-6 text-sm text-[var(--dim)]">読み込み中…</p>;
  }
  if (detail.error || !detail.data?.set) {
    return <p className="px-4 py-6 text-sm">プランセットを読み込めませんでした。</p>;
  }
  const set = detail.data.set;
  const isDone = set.status !== "creating" && set.status !== "failed";
  const hasSavedPlans = set.plans.length > 0;

  // Plans already saved stay viewable even while the set as a whole is
  // still generating (or failed partway): only a set with NO saved plan
  // yet gets the full-screen progress / failure view below.
  if (set.status === "creating" && !hasSavedPlans) {
    return (
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-10 text-center">
        <p className="font-display text-lg font-bold">
          {set.isRebuild ? "作り直し版を作成中です…" : "プランを作成中です…"}
        </p>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--dim)]">
          公式サイトで対象日の営業時間・休止情報・ショーの時刻と、現在のパス制度を確認してから、混雑シナリオの違う3プランを1つずつ作っています。作成には10〜20分ほどかかることがあります。このタブを開いたままでも、他のタブに移っても大丈夫です。
        </p>
        {set.isRebuild ? (
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--dim)]">
            既存のプランをもとに新しいプランを作っています。元のプランはそのまま残ります。
          </p>
        ) : null}
        <GenerationEscapeBlock
          setId={set.id}
          startedAt={startedAt}
          centered
          reportLines={progress}
        />
      </div>
    );
  }

  if (set.status === "failed" && !hasSavedPlans) {
    return (
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-10">
        <p className="font-display text-lg font-bold">
          {set.isRebuild ? "作り直しはできませんでした" : "プランを作れませんでした"}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
          公式情報を取得できませんでした。このセットは失敗状態です。条件は残っているので、リトライで最初から作り直せます。
        </p>
        {set.isRebuild ? (
          <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
            元のプランはそのまま残っています。
          </p>
        ) : null}
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
          条件を変えて、プラン作成タブの「この条件で3プランを作成」からもう一度お試しください。
        </p>
        <FailedSetRetryBlock setId={set.id} />
      </div>
    );
  }

  const visiblePlans = set.plans.filter((p) => p.slot === sub);
  const plan = visiblePlans[0];
  const entries: Entry[] = plan
    ? plan.rows.map((item) => ({ item, color: PLAN_COLORS[sub] }))
    : [];
  // A set without a crowd forecast has no 混雑予想 detail tab; if
  // that tab was left selected, fall back to the schedule so the
  // detail region never renders blank.
  const activeDetailTab =
    detailTab === "crowd" && set.congestion == null ? "schedule" : detailTab;

  // Tapping a schedule row moves the map to that row's place: the pin
  // is highlighted via the handle, and the LIVE map jumps to centre
  // on the place (at the map layer's fixed focus zoom; the map is not
  // remounted). Rows without coordinates have no pin to centre on.
  const handleRowTap = (entryIdx: number) => {
    const entry = entries[entryIdx];
    if (!entry || entry.item.lat == null || entry.item.lng == null) {
      return;
    }
    const pinnedIdx =
      entries
        .slice(0, entryIdx + 1)
        .filter((x) => x.item.lat != null && x.item.lng != null).length - 1;
    try {
      mapControllerRef.current?.selectPlace?.(pinnedIdx);
    } catch {
      /* selection is best-effort */
    }
    const target = { lat: entry.item.lat, lng: entry.item.lng };
    let panned = false;
    try {
      panned = mapControllerRef.current?.panTo?.(target) ?? false;
    } catch {
      panned = false;
    }
    if (!panned) {
      // The map may still be initialising (its camera is not ready);
      // retry the same pan once shortly after.
      window.setTimeout(() => {
        try {
          mapControllerRef.current?.panTo?.(target);
        } catch {
          /* pan is best-effort */
        }
      }, 350);
    }
  };

  return (
    <div
      className={`grid min-h-0 min-w-0 flex-1 grid-cols-1 ${
        showConditions
          ? "grid-rows-[auto_minmax(0,1fr)]"
          : "grid-rows-[auto_minmax(0,auto)_auto_minmax(0,1fr)] lg:grid-cols-2 lg:grid-rows-[auto_minmax(0,auto)_minmax(0,1fr)]"
      }`}
    >
      {/* Fixed top region: the sub-tab switcher stays put, with the map
          fixed below it; everything else lives in the detail region
          further down, which is the only part that scrolls. At desktop
          widths (lg and up) the same regions become a two-pane split
          instead: switcher, banners and detail stack in the left
          column, and the map fills the right column at full height so
          it stays visible while the detail region scrolls. While
          「条件」 is selected the grid collapses to the switcher plus
          one scrolling row holding the conditions panel alone — the
          map and the detail region are not rendered, so the map's
          fixed height cannot break the layout. */}
      <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 px-4 pt-3">
        <div
          ref={subTabBarRef}
          role="tablist"
          aria-label="プラン切替"
          className="flex min-w-0 flex-1 cursor-grab gap-1.5 overflow-x-auto pb-1"
        >
          {/* The strip is ONE exclusive tab group — 条件 / A / B / C:
              exactly one is selected at a time. Selecting 条件 shows
              this set's own search conditions INSTEAD of everything
              below the strip; selecting a plan switches back to the
              map + detail arrangement. */}
          <button
            type="button"
            role="tab"
            aria-selected={showConditions}
            aria-label="このプランの検索条件を表示"
            onClick={() => onSelectSlot(null)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold ${
              showConditions
                ? "bg-[var(--text)] text-[var(--bg)]"
                : "bg-[var(--surface-alt)] text-[var(--text)]"
            }`}
          >
            条件
          </button>
          {(["A", "B", "C"] as SubTab[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={!showConditions && sub === s}
              onClick={() => onSelectSlot(s)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold ${
                !showConditions && sub === s
                  ? "bg-[var(--text)] text-[var(--bg)]"
                  : "bg-[var(--surface-alt)] text-[var(--text)]"
              }`}
            >
              {`${s} ${SCENARIO_SHORT_LABELS[s]}`}
            </button>
          ))}
        </div>
        {/* Set deletion (with confirmation) stays at the strip's right
            end, outside the drag-scrolling tab list. */}
        {confirmDelete ? (
          <span className="flex shrink-0 items-center gap-1.5 pb-1">
            <button
              type="button"
              onClick={() => del.mutate()}
              disabled={del.isPending}
              className="rounded-full bg-[#e4572e] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              本当に削除
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-full bg-[var(--surface-alt)] px-3 py-1.5 text-sm font-semibold"
            >
              やめる
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label="このプランセットを削除"
            onClick={() => setConfirmDelete(true)}
            className="shrink-0 rounded-full bg-[var(--surface-alt)] px-3 py-1.5 text-sm font-semibold"
          >
            削除
          </button>
        )}
      </div>

      {/* Second grid row. In plan view it carries the status banners
          (generating / failed), collapsing to zero height when none
          shows. In 条件 view this row is the whole content area: it
          scrolls, and holds the set's search-conditions panel alone —
          the map and the detail region below are not rendered. */}
      <div
        className={`col-start-1 row-start-2 min-h-0 min-w-0 ${
          showConditions
            ? "overflow-x-hidden overflow-y-auto pb-6"
            : "overflow-x-hidden overflow-y-auto"
        }`}
      >
        {showConditions ? (
          <SetConditionsPanel condition={set.condition} />
        ) : (
          <>
            {set.status === "creating" ? (
              <div className="mx-4 mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
                <p className="text-sm font-semibold">
                  残りのプランを作成中です（作成には10〜20分ほどかかることがあります）
                </p>
                <GenerationEscapeBlock
                  setId={set.id}
                  startedAt={startedAt}
                  reportLines={progress}
                />
              </div>
            ) : null}
            {set.status === "failed" ? (
              <div
                role="alert"
                className="mx-4 mt-3 shrink-0 rounded-[var(--radius)] bg-red-100 px-3.5 py-2.5 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
              >
                作成は完了しませんでした。保存できたプランだけを表示しています。
                <FailedSetRetryBlock setId={set.id} />
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Map. On phones it is fixed at roughly the top 32% of the screen
          height, below the switcher; at desktop widths it becomes the
          right pane and fills the full height of the split. Not
          rendered at all while 「条件」 is selected. While 地図表示 is
          OFF the cell collapses to the height of the on/off toggle
          button alone (PlanMap renders nothing else then), so the
          detail region below takes over the map's space. */}
      {!showConditions ? (
        <div
          className={
            mapOff
              ? "col-start-1 row-start-3 mt-2 min-w-0 px-4 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:min-h-0 lg:px-0 lg:py-3"
              : "col-start-1 row-start-3 mt-3 h-[32dvh] min-w-0 px-4 lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:mt-0 lg:h-auto lg:min-h-0 lg:px-0 lg:py-3"
          }
        >
          {!plan ? (
            <p className="flex h-full items-center justify-center rounded-[var(--radius)] border border-dashed border-[var(--border)] px-3 py-2 text-center text-sm text-[var(--dim)]">
              プラン{sub}はまだありません。完了したプランは上のボタンから切り替えて見られます。
            </p>
          ) : set.status === "creating" ? (
            // While the set is still generating, the map is NOT mounted
            // at all: the pins are still changing underneath. The cell
            // holds a quiet placeholder and the map appears exactly
            // once, when creation is finished. The saved plans' lists
            // below stay readable in the meantime.
            <p className="flex h-full items-center justify-center rounded-[var(--radius)] border border-dashed border-[var(--border)] px-3 py-2 text-center text-sm text-[var(--dim)]">
              プランを作成中です。地図は、作成が終わってから表示されます。
            </p>
          ) : (
            <PlanMap
              entries={entries}
              mapKey={`${set.id}-${sub}-${entries
                .map(
                  (e) =>
                    `${e.item.id}:${e.item.lat ?? "-"},${e.item.lng ?? "-"}`,
                )
                .join("|")}`}
              pinColor={PLAN_COLORS[sub]}
              rowRefs={rowRefs}
              controllerRef={mapControllerRef}
              onVisibilityChange={handleMapVisibilityChange}
            />
          )}
        </div>
      ) : null}

      {/* Scrolling detail region, directly below the map: the summary
          heading (PlanCostHeader) at the head of the plan, then the
          detail tabs under it — スケジュール (the timeline list),
          プランの説明， and 混雑予想 (the set's crowd forecast level
          and its basis; the tab itself is absent on sets that carry
          no forecast). Not rendered at all while 「条件」 is
          selected. */}
      {!showConditions ? (
        <div className="col-start-1 row-start-4 mt-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-4 pb-6 [overflow-wrap:anywhere] lg:row-start-3">
          {set.isRebuild ? (
            <p className="mt-3 rounded-[var(--radius)] bg-[var(--surface-alt)] px-3.5 py-2.5 text-sm leading-relaxed">
              <span className="font-semibold">作り直し版</span>
              <span className="text-[var(--dim)]">
                ：既存のプランをもとに作り直した版です。元のプランもそのまま残っています。
              </span>
            </p>
          ) : null}
          <h2 className="sr-only">{set.title}</h2>
          {!plan ? (
            <div className="py-10 text-center">
              <p className="font-display text-base font-bold">
                プラン{sub}：まだありません
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--dim)]">
                完了したプランは上のボタンから見られます。
              </p>
            </div>
          ) : (
            <>
              <PlanCostHeader plan={plan} condition={set.condition} />

              <div
                role="tablist"
                aria-label="詳細切替"
                className="mt-3 flex gap-1.5 border-b border-[var(--border)]"
              >
                {(
                  [
                    { key: "schedule", label: "スケジュール" },
                    { key: "about", label: "プランの説明" },
                    ...(set.congestion != null
                      ? [
                          {
                            key: "crowd",
                            label: `混雑予想 ${set.congestion.level}/5`,
                          },
                        ]
                      : []),
                  ] as { key: "schedule" | "about" | "crowd"; label: string }[]
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={activeDetailTab === t.key}
                    onClick={() => setDetailTab(t.key)}
                    className={`-mb-px border-b-2 px-3 pb-2 pt-1 text-sm font-semibold ${
                      activeDetailTab === t.key
                        ? "border-[var(--accent)] text-[var(--text)]"
                        : "border-transparent text-[var(--dim)]"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Both panels stay mounted (hidden toggle) so the timeline
                  rows keep their refs and pin↔row sync with the fixed
                  map survives tab flips. */}
              <div className={activeDetailTab === "schedule" ? undefined : "hidden"}>
                <RowList
                  entries={entries}
                  rowRefs={rowRefs}
                  showPinNumbers
                  onRowTap={handleRowTap}
                />
              </div>
              {activeDetailTab === "about" ? (
                <div className="space-y-4 pt-3">
                  {plan.summary ? (
                    <section>
                      <h4 className="font-semibold">要約</h4>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                        {plan.summary}
                      </p>
                    </section>
                  ) : null}
                  {plan.budgetDisclosure ? (
                    <section>
                      <h4 className="font-semibold">予算について</h4>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                        {plan.budgetDisclosure}
                      </p>
                    </section>
                  ) : null}
                  {plan.droppedRequests.length > 0 ? (
                    <section>
                      <h4 className="font-semibold">取り込めなかった要求</h4>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
                        {plan.droppedRequests.map((d, i) => (
                          <li key={i}>
                            {d.request}：{d.reason}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  {set.congestion ? (
                    <section>
                      <h4 className="font-semibold">推定の材料</h4>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
                        {set.congestion.materials.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  {set.verification ? (
                    <VerificationRecord raw={set.verification} />
                  ) : null}
                </div>
              ) : null}
              {activeDetailTab === "crowd" && set.congestion ? (
                <div>
                  {/* The set's crowd forecast: the level as a 5-step
                      scale, then the basis the forecast was judged on —
                      both are the set's stored premise, shown as saved,
                      never re-derived here. */}
                  <div className="mt-4 flex items-end gap-3">
                    <p className="font-display text-3xl font-bold leading-none">
                      {set.congestion.level}
                      <span className="ml-1 text-base font-semibold text-[var(--dim)]">
                        / 5
                      </span>
                    </p>
                    <div
                      className="flex flex-1 gap-1 pb-1"
                      role="img"
                      aria-label={`混雑予想は5段階中${set.congestion.level}`}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span
                          key={n}
                          className={`h-2.5 flex-1 rounded-full ${
                            n <= (set.congestion?.level ?? 0)
                              ? "bg-[var(--accent)]"
                              : "bg-[var(--surface-alt)]"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-[var(--dim)]">
                    5に近いほど混雑が予想される日です。
                  </p>
                  {set.congestion.basis ? (
                    <div className="mt-4 text-sm leading-relaxed">
                      <p className="font-semibold">根拠</p>
                      <p className="mt-1 whitespace-pre-wrap">
                        {set.congestion.basis}
                      </p>
                    </div>
                  ) : null}
                  {set.congestion.materials.length > 0 ? (
                    <div className="mt-4 text-sm leading-relaxed">
                      <p className="font-semibold">使った材料</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5">
                        {set.congestion.materials.map((m, i) => (
                          <li key={i}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Fixed closing line of every plan display: the visible
                  form of the core contract — if something bothers you,
                  say so in the AI chat below and it can be fixed.
                  Display layer ONLY: a fixed literal rendered here
                  deterministically, never stored in plan data.
                  Rendered as a prominent call-out banner, NOT a small
                  footnote — most first-time readers don't yet know the
                  plan can be customized by asking the AI. */}
              {isDone ? (
                <div
                  role="note"
                  aria-label="プランの直し方の案内"
                  className="mt-6 rounded-[var(--radius)] border-2 border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))] px-4 py-4 sm:px-5"
                >
                  <p className="font-display text-lg font-bold leading-relaxed sm:text-xl">
                    気になるところがあれば、下のAIチャットで気軽に教えてください。待ち時間を減らしたり、順番を変えたり、作り直したりできます。
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
