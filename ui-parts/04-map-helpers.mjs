// ---------------------------------------------------------------------------
// Virtual map library — the plan map's abstraction layer.
//
// The app (PlanMap in App.tsx) talks to the map ONLY through
// mountPlaceListMap() and the handle it returns:
//
//   handle.destroy()                 tear the map down
//   handle.selectPlace(index)        highlight the pin for a place
//   handle.panTo({ lat, lng })       animated pan, current zoom kept;
//                                    false while the map is not ready
//                                    (the caller retries once, later)
//   handle.getZoom()                 current zoom, or null
//   handle.refreshSize()             re-measure the container and
//                                    re-render at its real size; the
//                                    app calls this whenever the
//                                    map's frame may have changed
//                                    size (Leaflet renders for the
//                                    size it last measured, so a
//                                    frame change it is not told
//                                    about leaves the map broken —
//                                    tiles clipped to the old size)
//
// plus the onUnavailable callback: the layer's single failure
// notification. The app answers it with its static-image fallback, so
// the fallback fires from here, never from the app guessing — and it
// fires only once EVERY implementation inside the layer has failed.
//
// Inside the layer there are two interchangeable implementations, and
// the layer — not the app — picks between them by probing the shell
// with HatchMaps.isMetaMapSupported():
//
//   (a) MetaMap — the platform map component (HatchMaps / MapLibre,
//       vector rendering; needs a Web Worker and WebGL), and
//   (b) Leaflet — the vendored Leaflet 1.9.4 (raster tile rendering;
//       no worker, no WebGL), used where the shell refuses workers
//       (e.g. the Mac desktop Muse app's view).
//
// The probe alone cannot be trusted to make that pick: it only checks
// that a blob Worker can be CONSTRUCTED (plus WebGL presence) — it
// never waits for the worker to actually run. A shell can allow
// construction while silently blocking execution (the Mac desktop
// Muse app's view does exactly this), so the probe reports
// "supported", MetaMap is chosen, and only the runtime's own async
// worker round-trip inside mountMap discovers the truth, seconds
// later, as a fatal error. Engine choice is therefore a cascade, not
// a verdict: a fatal error from the running MetaMap implementation
// is caught inside this layer, that engine is torn down, and the
// Leaflet implementation is mounted into the same container. The
// app is notified through onUnavailable only when Leaflet has failed
// too — every branch inside the layer ends at a real interactive
// map, and the static image remains the emergency exit for the case
// where no engine could run at all.
//
// The base-layer choice arrives engine-neutral ("standard" |
// "satellite") and each implementation maps it to its own sources.
// For Leaflet: standard = Geospatial Information Authority of Japan
// (GSI) standard tiles, satellite = Esri World Imagery served
// directly from server.arcgisonline.com (both verified to answer
// embedded tile requests with real 200 image tiles). The OSM tile
// host (tile.openstreetmap.org) is deliberately NOT used on this
// path: in some embedding contexts it answers with an HTTP 403
// policy-block image that still "loads" as an image. Tile success is
// therefore never judged by tile load events anywhere in this layer;
// the fallback trigger is initialisation success/failure only.
//
// A future engine can be added behind this same interface without
// touching the app: implement the handle, add a branch to the probe
// dispatch in mountPlaceListMap, done.

import L from "./leaflet.js";
import "./leaflet.css";

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
// throwing probe counts as "not supported" — the Leaflet
// implementation is the safer default in that case. The probe is a
// first guess only (see the header: it tests Worker construction,
// not execution), so the facade treats a later fatal error from the
// MetaMap engine as the probe having been wrong and cascades to
// Leaflet instead of reporting failure.
function metaMapSupported() {
  try {
    return globalThis.HatchMaps?.isMetaMapSupported?.().supported === true;
  } catch {
    return false;
  }
}

// ------------------------------------------- implementation (a): MetaMap
//
// The platform map component (HatchMaps / MapLibre), unchanged from
// the original implementation. The caller renders the same non-map
// content for unsupported and fatal cases.
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

// ------------------------------------------- implementation (b): Leaflet
//
// The vendored Leaflet 1.9.4: pre-rendered raster tiles laid out in
// the page, so no Web Worker and no WebGL are involved. Pins are
// divIcons carrying the same .pin markup the MetaMap implementation
// renders, so the pin look (26px circle, plan colour via the
// container's --pin-color, .pin--on when selected) is shared CSS,
// not a second design.

// Base layers for the Leaflet implementation, keyed by the layer's
// engine-neutral names. Standard: GSI (Geospatial Information
// Authority of Japan) standard tiles — this app only ever maps Tokyo
// Disney Resort, so Japan-only coverage is sufficient, and the GSI
// terms require the 「国土地理院」 credit. Satellite: Esri World
// Imagery from Esri's direct tile service (no redirect hop).
const LEAFLET_BASE_LAYERS = {
  standard: {
    url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
    attribution: "国土地理院",
    maxZoom: 18,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19,
  },
};

function leafletPinIcon(index, selected) {
  return L.divIcon({
    className: "pin-marker",
    html: `<div class="pin${selected ? " pin--on" : ""}">${index + 1}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function mountLeafletPlaceListMap(container, options, onUnavailable) {
  const {
    rows,
    selectedClass = 'map-selected',
    userLocation,
    baseLayer,
    places,
  } = options;
  if (!L || typeof L.map !== "function" || !places || places.length === 0) {
    onUnavailable();
    return null;
  }
  const highlight = (index, scroll) => {
    rows.forEach((row, i) => row.classList.toggle(selectedClass, i === index));
    if (scroll && index !== null) {
      rows[index].scrollIntoView({ block: 'nearest' });
    }
  };
  let map = null;
  let markers = [];
  let destroyed = false;
  const rowListeners = [];
  const panTimers = [];
  const setSelected = index => {
    markers.forEach((marker, i) => marker.setIcon(leafletPinIcon(i, i === index)));
  };
  const handle = {
    destroy() {
      destroyed = true;
      panTimers.forEach(t => window.clearTimeout(t));
      panTimers.length = 0;
      rowListeners.forEach(([row, listener]) =>
        row.removeEventListener('click', listener),
      );
      rowListeners.length = 0;
      try {
        map?.remove();
      } catch {
        /* map already gone */
      }
      map = null;
      markers = [];
    },
    selectPlace(index) {
      setSelected(index);
    },
    panTo(target) {
      if (!map || destroyed) return false;
      try {
        // panTo changes only the centre: the zoom the user currently
        // has is preserved, and the move animates (~0.7s, matching
        // the MetaMap implementation's easeTo duration).
        const before = map.getCenter();
        map.panTo([target.lat, target.lng], { animate: true, duration: 0.7 });
        // Completion guarantee: Leaflet's pan animation is driven
        // by requestAnimationFrame, which a shell can suspend for an
        // embedded or off-screen page — the animation then never
        // progresses and the camera would stay put despite the
        // request. If, once the animation's duration has passed, the
        // centre has not moved at all, land the same move instantly
        // (zoom as it stands then). When the animation runs — the
        // normal case — the centre has moved or arrived and this
        // does nothing; a centre the user moved themselves in the
        // meantime is likewise left alone.
        panTimers.push(
          window.setTimeout(() => {
            if (!map || destroyed) return;
            try {
              const now = map.getCenter();
              if (now.lat === before.lat && now.lng === before.lng) {
                map.setView([target.lat, target.lng], map.getZoom(), {
                  animate: false,
                });
              }
            } catch {
              /* completion is best-effort */
            }
          }, 900),
        );
        return true;
      } catch {
        return false;
      }
    },
    getZoom() {
      try {
        return map ? map.getZoom() : null;
      } catch {
        return null;
      }
    },
    refreshSize() {
      // Leaflet renders for the container size it last measured
      // and never re-measures on its own: after the frame around
      // the map changes size, its panes and tiles stay laid out
      // for the old size and the map reads as broken until it is
      // told. invalidateSize is that telling.
      if (!map || destroyed) return;
      try {
        map.invalidateSize();
      } catch {
        /* size refresh is best-effort */
      }
    },
  };
  try {
    map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
    });
    // Zoom buttons top-right and the attribution bottom-right, the
    // same corners the MetaMap implementation uses (theme.css lifts
    // the bottom-right corner above the 現在地 button).
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);
    const base = LEAFLET_BASE_LAYERS[baseLayer === 'satellite' ? 'satellite' : 'standard'];
    L.tileLayer(base.url, {
      attribution: base.attribution,
      maxZoom: base.maxZoom,
    }).addTo(map);
    // Open framed on every pin; a single spot opens at park-detail
    // zoom 16, like the MetaMap implementation's fit.
    map.fitBounds(
      L.latLngBounds(places.map(p => [p.lat, p.lng])),
      { padding: [28, 28], maxZoom: 16 },
    );
    markers = places.map((place, index) => {
      const marker = L.marker([place.lat, place.lng], {
        icon: leafletPinIcon(index, false),
      }).addTo(map);
      marker.on('click', () => {
        setSelected(index);
        highlight(index, true);
      });
      return marker;
    });
    if (userLocation) {
      // The viewer's own position: the same blue dot + halo the
      // MetaMap overlay draws (fixed pixel radii, #2f6fd0). Added
      // after the fit and kept out of `places`, so it never affects
      // the initial view or the pin numbering.
      L.circleMarker([userLocation.lat, userLocation.lng], {
        radius: 16,
        stroke: false,
        fillColor: '#2f6fd0',
        fillOpacity: 0.2,
        interactive: false,
      }).addTo(map);
      L.circleMarker([userLocation.lat, userLocation.lng], {
        radius: 7,
        color: '#FFFFFF',
        weight: 3,
        fillColor: '#2f6fd0',
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
    }
    rows.forEach((row, index) => {
      const listener = () => {
        handle.selectPlace(index);
        highlight(index, false);
      };
      row.addEventListener('click', listener);
      rowListeners.push([row, listener]);
    });
  } catch {
    // Initialisation failed (library missing, exception while
    // building the map): tear down any partial map and report
    // through the layer's single failure channel.
    try {
      map?.remove();
    } catch {
      /* nothing to tear down */
    }
    map = null;
    markers = [];
    onUnavailable();
    return null;
  }
  return handle;
}

// ------------------------------------------------------------ facade
//
// The app's only entry point. The probe makes the first pick; the app
// never learns which implementation it got — both return the same
// handle shape and report failure through the same onUnavailable.
//
// When the probe picks MetaMap, the handle returned here is a
// switching handle that delegates to whichever implementation is
// live. That indirection exists because the MetaMap engine can fail
// AFTER a successful mount return: its real worker test runs
// asynchronously inside the runtime and reports through the fatal
// callback seconds later. The facade answers that callback itself —
// it tears the MetaMap engine down and mounts the Leaflet
// implementation into the same container — and only a Leaflet
// failure reaches the app's onUnavailable. (The Meta implementation
// also reports synchronously, before returning, when its own
// support check fails at mount time; the same cascade handles that
// path, and the local-variable capture below keeps the synchronous
// cascade from being overwritten by the mount call's null return.)
export function mountPlaceListMap(container, options, onUnavailable) {
  if (!metaMapSupported()) {
    return mountLeafletPlaceListMap(container, options, onUnavailable);
  }
  let destroyed = false;
  let failedOver = false;
  let active = null;
  const startLeaflet = () => {
    if (destroyed || active) return;
    active = mountLeafletPlaceListMap(container, options, () => {
      if (!destroyed) onUnavailable();
    });
  };
  const tearDown = (handle) => {
    try {
      handle?.destroy?.();
    } catch {
      /* engine already gone */
    }
    try {
      handle?.remove?.();
    } catch {
      /* engine already gone */
    }
  };
  const failOver = () => {
    if (destroyed || failedOver) return;
    failedOver = true;
    const meta = active;
    active = null;
    tearDown(meta);
    startLeaflet();
  };
  const handle = {
    destroy() {
      destroyed = true;
      const current = active;
      active = null;
      tearDown(current);
    },
    selectPlace(index) {
      try {
        active?.selectPlace?.(index);
      } catch {
        /* selection is best-effort */
      }
    },
    panTo(target) {
      try {
        return active?.panTo?.(target) ?? false;
      } catch {
        return false;
      }
    },
    getZoom() {
      try {
        return active?.getZoom?.() ?? null;
      } catch {
        return null;
      }
    },
    refreshSize() {
      try {
        active?.refreshSize?.();
      } catch {
        /* size refresh is best-effort */
      }
    },
  };
  const meta = mountMetaPlaceListMap(container, options, failOver);
  if (meta) {
    active = meta;
  } else if (!failedOver) {
    // The Meta implementation declined without reporting through the
    // callback (its mount helper normally reports synchronously,
    // which failOver already handled): fall through to Leaflet
    // rather than giving up on the map.
    failedOver = true;
    startLeaflet();
  }
  return handle;
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
