// ---------------------------------------------------------------------------
// Virtual map library — the plan map's abstraction layer.
//
// Ported from the home app's map_helpers (ui-parts 04-map-helpers.mjs),
// keeping ONLY the implementation this app's map mechanism can carry:
// the platform map component (HatchMaps / MapLibre). The home layer's
// second implementation — the vendored Leaflet engine — is NOT carried:
// this app has no vendored Leaflet files, and its map runs on
// hatch-maps alone (per the porting brief). Where the home layer would
// cascade from a failed MetaMap mount to Leaflet, this layer reports
// through onUnavailable instead, and the app answers with its
// static-image fallback — the fallback therefore fires only when the
// platform map itself cannot run.
//
// The app (PlanMap) talks to the map ONLY through mountPlaceListMap()
// and the handle it returns:
//
//   handle.destroy()                 tear the map down
//   handle.selectPlace(index)        highlight the pin for a place
//   handle.panTo({ lat, lng })       animated pan, current zoom kept;
//                                    false while the map is not ready
//                                    (the caller retries once, later)
//   handle.getZoom()                 current zoom, or null
//   handle.refreshSize()             re-measure the container and
//                                    re-render at its real size
//
// plus the onUnavailable callback: the layer's single failure
// notification.
//
// The base-layer choice arrives engine-neutral ("standard" |
// "satellite") and is mapped to this runtime's named styles:
// "light" is the standard vector basemap, "esri-clarity" the
// satellite-imagery style built from Esri World Imagery tiles.

const STATIC_MAP_BASE = "https://external.xx.fbcdn.net/static_map.php";

export function buildStaticMapUrl(opts) {
  const params = new URLSearchParams();
  params.set("v", "2067");
  params.set("ccb", "4-4");
  params.set("center", `${opts.center[0]},${opts.center[1]}`);
  params.set("zoom", String(opts.zoom));
  params.set("size", `${opts.width ?? 400}x${opts.height ?? 400}`);
  if (opts.scale != null) params.set("scale", String(opts.scale));
  if (opts.format) params.set("format", opts.format);
  if (opts.theme) params.set("theme", opts.theme);
  if (opts.language) params.set("language", opts.language);
  if (opts.region) params.set("region", opts.region);
  params.set("show_attribution", "1");
  params.set("_nc_client_caller", "Muse_Artifact");
  params.set("_nc_client_id", "artifact_static");
  if (opts.markers?.length) {
    params.set("markers", opts.markers.map(m => [
      ...(m.scale && m.scale !== 1 ? [`scale:${m.scale}`] : []),
      `${m.position[0]},${m.position[1]}`,
    ].join("|")).join("|"));
  }
  return `${STATIC_MAP_BASE}?${params.toString()}`;
}

// Omit complete address components already included in preceding fields.
function placeQuery(place) {
  const parts = [];
  const alreadySaid = (haystack, needle) => {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
  };
  for (const raw of [
    place.venue || place.label,
    place.address,
    place.locality,
    place.region,
    place.country,
  ]) {
    const value = (raw || "").trim();
    if (!value) continue;
    if (alreadySaid(parts.join(", "), value)) continue;
    parts.push(value);
  }
  return parts.join(", ");
}

// Prefer a name with an address or locality; otherwise use known coordinates.
function placeTarget(place) {
  const name = (place.venue || place.label || "").trim();
  const hasLocator = Boolean(
    (place.address && place.address.trim()) || (place.locality && place.locality.trim()),
  );
  if (name && hasLocator) return placeQuery(place);
  if (typeof place.lat === "number" && typeof place.lng === "number") {
    return `${place.lat},${place.lng}`;
  }
  return placeQuery(place);
}

function isCoordinatePair(value) {
  return /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(value.trim());
}

function encodeMapsValue(value) {
  const trimmed = value.trim();
  if (isCoordinatePair(trimmed)) return trimmed;
  return encodeURIComponent(trimmed);
}

function mapsUrl(base, params) {
  const query = Object.entries(params)
    .filter(entry => Boolean(entry[1]))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeMapsValue(value)}`)
    .join("&");
  return `${base}?${query}`;
}

export function mapsSearchUrl(place) {
  const query = placeTarget(place);
  if (!query) return null;
  return mapsUrl("https://www.google.com/maps/search/", {
    api: "1",
    query,
  });
}

export function mapsDirectionsUrl(destination, options = {}) {
  const destinationValue = placeTarget(destination);
  if (!destinationValue) return null;
  return mapsUrl("https://www.google.com/maps/dir/", {
    api: "1",
    destination: destinationValue,
    origin: options.origin ? `${options.origin.lat},${options.origin.lng}` : undefined,
    travelmode: options.travelmode,
  });
}

// ------------------------------------------------------- engine probe
//
// The one place the layer looks at the shell: can the platform map
// component (Web Worker + WebGL) run here? A missing runtime or a
// throwing probe counts as "not supported".
function metaMapSupported() {
  try {
    return globalThis.HatchMaps?.isMetaMapSupported?.().supported === true;
  } catch {
    return false;
  }
}

// ------------------------------------------- implementation: MetaMap
//
// The platform map component (HatchMaps / MapLibre). The caller renders
// the same non-map content for unsupported and fatal cases.
export function mountMap(container, options, onUnavailable) {
  const { supported } = globalThis.HatchMaps.isMetaMapSupported();
  if (!supported) {
    onUnavailable();
    return null;
  }
  return globalThis.HatchMaps.mountMap(container, {
    ...options,
    clientId: 'artifact_web',
    onFatalError: onUnavailable,
  });
}

// The viewer's own position as a map overlay: a blue dot with a soft
// halo, drawn from a GeoJSON point source. It is deliberately NOT one
// of the numbered `places` — the runtime fits the initial view to the
// places, and a viewer at home would drag that view far off the park;
// an overlay renders on top without touching the fit or the pin
// numbering. The halo is a fixed pixel radius (a visual cue, not a
// metres-accurate accuracy circle).
export function userLocationOverlay(loc) {
  return {
    id: 'user-location',
    data: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [loc.lng, loc.lat] },
        properties: {},
      }],
    },
    layers: [
      {
        id: 'user-location-halo', type: 'circle', source: 'user-location',
        paint: {
          'circle-radius': 16,
          'circle-color': '#2f6fd0',
          'circle-opacity': 0.2,
        },
      },
      {
        id: 'user-location-dot', type: 'circle', source: 'user-location',
        paint: {
          'circle-radius': 7,
          'circle-color': '#2f6fd0',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#FFFFFF',
        },
      },
    ],
  };
}

// Pin-tap detection for the MetaMap implementation, owned by this
// layer rather than left to the runtime's onSelectPlace alone.
//
// The runtime does wire marker clicks to onSelectPlace, but a mouse
// click on a pin in Chrome ends DESELECTED (owner report; touch on
// the phone worked). Reproduced in a real Chrome with this layer's
// real code and the cause proven by instrumenting the class toggles
// and the clicked pin's connectivity:
//
//   1. The runtime's marker listener selects: onSelectPlace(index)
//      highlights the row and scrolls to it — the scroll the owner
//      saw — and sets the runtime's own selection state.
//   2. That state update re-renders the marker with its selected
//      styling by swapping the pin element's innerHTML, which
//      DETACHES the very pin element the click targeted, mid-
//      dispatch (verified: the clicked pin ends isConnected ===
//      false, replaced by a fresh element).
//   3. The same native click keeps bubbling to the map's canvas
//      container, where the runtime's map-click handler runs its
//      "not a marker" guard — originalEvent.target.closest(
//      '.maplibregl-marker') — against the now-detached target.
//      The walk finds no marker, so the guard fails and the handler
//      DESELECTS: onSelectPlace(null) removes the row highlight
//      (and clears the pin's selected state) ~2ms after it was
//      applied. The runtime cannot fix its guard from inside: by
//      the time it runs, the node it must inspect is already gone.
//
// This layer's listener sits on the mount container, last in the
// bubble chain, so a correct re-apply here lands after that
// deselect and is the final state. But it must not repeat the
// runtime's mistake: the event target is the detached pin, so the
// tapped marker is resolved from the event's COORDINATES against
// the live DOM — document.elementFromPoint returns the replacement
// pin (same spot, still inside its .maplibregl-marker) — with the
// target walk kept as a fallback for events without coordinates.
// The pin's index is read from the number the pin itself displays
// (unambiguous regardless of marker DOM order), with DOM order
// among the container's markers as the fallback. Selection through
// here also calls the runtime's selectPlace so the pin's own
// .pin--on state — cleared by the misfired deselect — is restored;
// both paths landing on the same index is idempotent.
//
//   - 'click' covers mouse taps and any synthesized click that
//     survives; running last in the bubble chain means the deselect
//     misfire inside the map is re-applied over, never the reverse.
//   - 'touchend' covers touch taps whose click was suppressed (a
//     touch handler inside the map can preventDefault the touch and
//     suppress the synthesized click entirely; the event still
//     dispatches — preventDefault stops default actions, not
//     listeners). A touch only counts as a tap when it stayed
//     within ~12px and ~600ms, so a pan that merely started on a
//     pin never selects it.
//
// Returns a detach function.
function attachMetaMarkerTapSelection(container, map, highlight) {
  let detached = false;
  let touchStart = null;
  const indexFromMarker = markerEl => {
    const pin = markerEl.querySelector('.pin');
    const num = pin ? Number.parseInt(pin.textContent ?? '', 10) : NaN;
    if (Number.isFinite(num) && num >= 1) return num - 1;
    const markers = container.querySelectorAll('.maplibregl-marker');
    const idx = Array.prototype.indexOf.call(markers, markerEl);
    return idx >= 0 ? idx : null;
  };
  const indexFromEvent = event => {
    // Primary: hit-test the tap's coordinates against the LIVE
    // marker elements (see the header: the event target may be a
    // detached, already-replaced pin).
    const point =
      event.changedTouches?.[0] ??
      (typeof event.clientX === 'number' ? event : null);
    if (point && typeof document.elementFromPoint === 'function') {
      const hit = document.elementFromPoint(point.clientX, point.clientY);
      const markerEl =
        hit && typeof hit.closest === 'function'
          ? hit.closest('.maplibregl-marker')
          : null;
      if (markerEl && container.contains(markerEl)) {
        return indexFromMarker(markerEl);
      }
    }
    // Fallback: walk up from the event target (valid whenever the
    // pin was not replaced mid-dispatch, e.g. a tap that changed
    // nothing in the runtime's selection state).
    const target = event.target;
    const markerEl =
      target && typeof target.closest === 'function'
        ? target.closest('.maplibregl-marker')
        : null;
    if (!markerEl || !container.contains(markerEl)) return null;
    return indexFromMarker(markerEl);
  };
  const select = event => {
    const index = indexFromEvent(event);
    if (index === null) return;
    highlight(index, true);
    try {
      map.selectPlace?.(index);
    } catch {
      /* pin state sync is best-effort */
    }
  };
  const onTouchStart = event => {
    const t = event.changedTouches?.[0];
    touchStart = t
      ? { x: t.clientX, y: t.clientY, time: Date.now() }
      : null;
  };
  const onTouchEnd = event => {
    const start = touchStart;
    touchStart = null;
    if (!start) return;
    const t = event.changedTouches?.[0];
    if (!t) return;
    const moved = Math.hypot(t.clientX - start.x, t.clientY - start.y);
    if (moved > 12 || Date.now() - start.time > 600) return;
    select(event);
  };
  container.addEventListener('click', select);
  container.addEventListener('touchstart', onTouchStart, { passive: true });
  container.addEventListener('touchend', onTouchEnd);
  return () => {
    if (detached) return;
    detached = true;
    container.removeEventListener('click', select);
    container.removeEventListener('touchstart', onTouchStart);
    container.removeEventListener('touchend', onTouchEnd);
  };
}

// For short place lists. Style .pin, .pin--on, and the selected row class.
function mountMetaPlaceListMap(container, options, onUnavailable) {
  const { rows, selectedClass = 'map-selected', userLocation, baseLayer, ...mapOptions } = options;
  const highlight = (index, scroll) => {
    rows.forEach((row, i) => row.classList.toggle(selectedClass, i === index));
    if (scroll && index !== null) {
      rows[index].scrollIntoView({ block: 'nearest' });
    }
  };
  const overlays = [...(mapOptions.overlays ?? [])];
  if (userLocation) overlays.push(userLocationOverlay(userLocation));
  const map = mountMap(container, {
    ...mapOptions,
    // Engine-neutral base layer → this runtime's named styles:
    // "light" is the standard vector basemap, "esri-clarity" the
    // satellite-imagery style built from Esri World Imagery tiles.
    baseStyle: baseLayer === 'satellite' ? 'esri-clarity' : 'light',
    ...(overlays.length > 0 ? { overlays } : {}),
    marker: (_place, index, selected) =>
      `<div class="pin${selected ? ' pin--on' : ''}">${index + 1}</div>`,
    onSelectPlace: index => highlight(index, true),
  }, onUnavailable);
  if (map === null) return null;
  // The layer's own pin-tap detection (see above): wraps the
  // runtime handle so teardown removes the container listeners
  // whichever of destroy/remove the caller uses.
  const detachTapSelection = attachMetaMarkerTapSelection(
    container,
    map,
    highlight,
  );
  const teardown = fn => {
    detachTapSelection();
    try {
      fn?.();
    } catch {
      /* engine already gone */
    }
  };
  const handle = {
    destroy() {
      teardown(() => map.destroy?.());
    },
    remove() {
      teardown(() => map.remove?.());
    },
    selectPlace(index) {
      map.selectPlace?.(index);
    },
    panTo(target) {
      return map.panTo?.(target) ?? false;
    },
    getZoom() {
      return map.getZoom?.() ?? null;
    },
    refreshSize() {
      // The MapLibre runtime tracks its container's size itself;
      // forward to its resize when the handle happens to expose
      // one, and otherwise this is a deliberate no-op.
      try {
        map.resize?.();
      } catch {
        /* size refresh is best-effort */
      }
    },
  };
  rows.forEach((row, index) => {
    row.addEventListener('click', () => {
      handle.selectPlace(index);
      highlight(index, false);
    });
  });
  return handle;
}

// ------------------------------------------------------------ facade
//
// The app's only entry point. Unlike the home app's layer there is
// no second engine to cascade to: when the platform map cannot run,
// the failure reaches the app's onUnavailable and the app shows its
// static-image fallback.
export function mountPlaceListMap(container, options, onUnavailable) {
  if (!metaMapSupported()) {
    onUnavailable();
    return null;
  }
  return mountMetaPlaceListMap(container, options, onUnavailable);
}

// colorStops is an alternating density/color array, including transparency at 0.
export function heatmapOverlay(id, data, colorStops, radius = 20) {
  return {
    id,
    data,
    layers: [{
      id: `${id}-density`,
      type: 'heatmap',
      source: id,
      paint: {
        'heatmap-radius': radius,
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], ...colorStops],
      },
    }],
  };
}

// Fetch published geometry and join caller-supplied rates before mounting.
// colorStops is an alternating value/color array derived from the artifact.
// The page owns its hover text: pass missingLabel in the artifact's language,
// or tooltip to replace the default line entirely.
export async function mountChoropleth(container, options, onUnavailable) {
  const {
    boundaryUrl, rows, featureKey, rowKey, valueKey, colorStops, outlineColor,
    missingLabel = 'no data', tooltip,
    ...mapOptions
  } = options;
  const { supported } = globalThis.HatchMaps.isMetaMapSupported();
  if (!supported) {
    onUnavailable();
    return null;
  }

  let geometry;
  try {
    const response = await fetch(boundaryUrl);
    if (!response.ok) throw new Error(`Boundary fetch failed: ${response.status}`);
    geometry = await response.json();
  } catch {
    onUnavailable();
    return null;
  }
  const values = new Map(rows.map(row => [row[rowKey], row[valueKey]]));
  for (const feature of geometry.features) {
    feature.properties.value = values.get(feature.properties[featureKey]) ?? null;
  }
  return mountMap(container, {
    ...mapOptions,
    baseStyle: 'grayscale',
    tooltip: tooltip ?? (feature =>
      `${feature.properties.name}: ${feature.properties.value ?? missingLabel}`),
    overlays: [{
      id: 'regions',
      data: geometry,
      layers: [
        {
          id: 'regions-fill', type: 'fill', source: 'regions',
          filter: ['!=', ['get', 'value'], null],
          paint: {
            'fill-color': ['interpolate', ['linear'], ['get', 'value'], ...colorStops],
            'fill-opacity': 0.45,
          },
        },
        {
          id: 'regions-outline', type: 'line', source: 'regions',
          paint: { 'line-color': outlineColor, 'line-width': 1 },
        },
      ],
    }],
  }, onUnavailable);
}
