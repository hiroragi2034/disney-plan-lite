// ---------------------------------------------------------------- map view

// ------------------------------------------------- static map fallback
//
// The interactive map comes from the virtual map library in
// map_helpers.mjs: the layer probes the shell and internally runs
// either the platform map component (MapLibre — needs a Web Worker
// and WebGL) or its Leaflet implementation (raster tiles — neither),
// and PlanMap neither knows nor cares which one it got. The layer's
// probe only tests that a Worker can be constructed, not that it can
// actually run, so a shell that silently blocks worker execution
// (the Mac desktop Muse app's view) first picks the platform
// component and fails seconds later; the layer answers that itself
// by tearing the failed engine down and mounting the other one.
// Only when the layer reports failure through onUnavailable — every
// engine inside it failed — does PlanMap fall back to Meta's static
// map image of the same pinned places (a still map beside the place
// list). It needs
// no worker and no WebGL, only an ordinary image load. The places
// are runtime data (each plan's own items), so the image is
// requested at view time from the runtime coordinates via
// buildStaticMapUrl, framed on the pins' bounding box at the frame's
// real size. If even the image fails to load, PlanMap falls back to
// the text-only message. The viewer's own 現在地 is never included —
// only the plan's places are drawn.

// Web-Mercator projection for framing the static image (the same
// math pdf.ts uses for its printed maps).
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
// static map image can be requested at the frame's real size (the
// static service has no fit-bounds: size + centre + zoom fully
// determine the picture). Updates are thresholded so a resize does
// not refetch on every pixel.
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
  entries: { item: PlanItem; color: string }[];
  mapKey: string;
  pinColor?: string;
  // Reports the 地図表示 on/off state to the parent layout, which owns
  // the map cell's size: when off, the parent collapses the cell to
  // just the toggle button's height so the detail region below takes
  // over the freed space (a same-size placeholder frame would defeat
  // the point of turning the map off).
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
  // frame-size effect below can ask it to re-measure. The mount
  // effect owns setting and clearing it.
  const mapHandleRef = useRef<MapController | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // Static-image fallback (see the helpers above PlanMap): when the
  // map layer reports the interactive map unavailable — every engine
  // inside it failed, after the layer's own engine-to-engine
  // cascade — PlanMap shows Meta's static map image of the same pins
  // instead of only a text apology. staticImgFailed means even that image could not be
  // loaded; only then does the text-only message appear. retryNonce
  // re-runs the mount effect when the viewer taps 「地図を再読み込み」
  // on the static image (a fatal error can be transient — a failed
  // style fetch — so the retry starts from the layer's probe again).
  const [staticImgFailed, setStaticImgFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const { ref: frameRef, size: frameSize } =
    useElementSize<HTMLDivElement>();
  useEffect(() => {
    setStaticImgFailed(false);
  }, [mapKey]);
  // Basemap toggle: 通常地図 vs 衛星地図, expressed engine-neutrally
  // ("standard" | "satellite") — which sources those names mean is
  // the map layer's business, not the app's: the MetaMap engine maps
  // them to its named styles (standard vector basemap / the
  // "esri-clarity" satellite style built from Esri World Imagery
  // tiles served directly by server.arcgisonline.com, not the stock
  // clarity.maptiles.arcgis.com URL whose every tile goes through a
  // 301 redirect to the Wayback archive host — the fragile hop behind
  // the satellite view coming up black), the Leaflet engine to its
  // GSI standard tiles / the same Esri World Imagery service. Either
  // way the numbered pins render on top unchanged.
  const [baseLayer, setBaseLayer] = useState<"standard" | "satellite">("standard");
  // 地図表示 on/off (owner's toggle): when off, the map itself is not
  // mounted at all — only the toggle button remains, so the map can
  // always be brought back, AND the parent layout collapses the map
  // cell to the button's height (reported via onVisibilityChange), so
  // the map's space disappears with it and the list below expands.
  // The state lives here (not in the parent) so it survives A/B/C
  // switches within the same plan tab; toggling back on remounts the
  // map via the mount effect's dependency on this flag.
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
  // pretending — the honest-failure shape the owner asked for.
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
      label: e.item.name,
      lat: e.item.lat as number,
      lng: e.item.lng as number,
    }));
    // The layer's handle teardown is destroy(). Calling it here is
    // what makes the basemap toggle work: without it the previous
    // basemap stays mounted on the same container and the new layer
    // never becomes visible.
    let map: {
      destroy?: () => void;
      remove?: () => void;
      selectPlace?: (index: number) => void;
      panTo?: (target: { lat: number; lng: number }) => boolean;
      getZoom?: () => number | null;
      refreshSize?: () => void;
    } | null = null;
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
      );
      mapHandleRef.current = map as unknown as MapController | null;
      if (controllerRef) {
        controllerRef.current = map as unknown as MapController | null;
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
    // happens here any more.
    // A fresh 現在地 position remounts the map (the dot overlay is
    // part of the mount options); once mounted, centre on the viewer.
    // panTo returns false while the map is still initialising, so
    // retry on a short ladder — the same pattern row taps use.
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
        map?.destroy?.();
        map?.remove?.();
      } catch {
        /* map already gone */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey, baseLayer, userLocKey, mapVisible, retryNonce]);

  // Keep the map's internal size in step with its frame. The frame
  // changes size whenever content appears or disappears in the
  // banner row above it (the PDF progress / completion block, the
  // generating banners) and when the window itself resizes; the
  // raster engine (Leaflet) renders for the size it last measured
  // and never re-measures on its own, so an untold change leaves
  // its tiles laid out for a size the container no longer has —
  // the map the owner saw break after creating a PDF. frameSize
  // already tracks the frame through a ResizeObserver (it feeds
  // the static fallback's framing); every real change now also
  // asks the live map to re-measure and re-render at the true
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

  // 地図表示 on/off toggle (owner's placement: the map's TOP-LEFT).
  // With the map on it overlays the map's top-left corner; with the
  // map off it renders in normal flow as the ONLY content of the
  // (now collapsed) map cell — it must never disappear while the map
  // is off: it is the only way back.
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
    // link under it (the image's own baked-in credit stays
    // uncropped: the requested size matches the frame, so
    // object-cover crops nothing). Static pins carry no numbers —
    // the caption says so, and the numbered list below remains the
    // order reference. The basemap toggle and 現在地 button belong
    // to the live map and are not shown here; 「地図を再読み込み」
    // retries the interactive map once.
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
        .map((p) => ({ position: [p.lat, p.lng] })),
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
      {/* 現在地 button: bottom-right (owner's placement), with the
          map's copyright attribution directly above it (theme.css
          lifts the attribution corner by this button's height). One
          tap = one position fix; the map centres on the blue dot.
          While a fix is in flight the button is disabled and says so. */}
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

// Name key for matching a schedule row to the verification record's
// normalized DPA fact list (same normalization the server uses
// for its facility dictionary): NFKC, whitespace removed, lower-cased.
