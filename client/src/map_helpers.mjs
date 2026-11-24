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
//                                    and centre the live map on it
//                                    (the two are written together;
//                                    see steerCamera in
//                                    mountMetaPlaceListMap)
//   handle.panTo({ lat, lng })       centre the live map on a place;
//                                    false only for an invalid target
//                                    (how this works on a runtime
//                                    whose handle has no camera
//                                    method: see mountMetaPlaceListMap)
//   handle.getZoom()                 the focus zoom panTo set, or null
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

// The zoom a pan centres the map at: the same level the runtime's
// initial fitBounds caps at (maxZoom 16), so a focused place and its
// surroundings stay readable and a tap never zooms in past the
// framing the map opened with.
const FOCUS_ZOOM = 16;

// For short place lists. Style .pin, .pin--on, and the selected row class.
function mountMetaPlaceListMap(container, options, onUnavailable) {
  const { rows, selectedClass = 'map-selected', userLocation, baseLayer, ...mapOptions } = options;
  // The selection as this layer last saw it, from either direction
  // (row tap via the handle, pin tap via onSelectPlace). panTo needs
  // it to restore the selection after forcing a re-render.
  let selectedIndex = null;
  // Alternates on every pan so the zoom value written into the mount
  // options always changes (see panTo).
  let focusZoomFlip = false;
  const highlight = (index, scroll) => {
    selectedIndex = index;
    rows.forEach((row, i) => row.classList.toggle(selectedClass, i === index));
    if (scroll && index !== null) {
      rows[index].scrollIntoView({ block: 'nearest' });
    }
  };
  const overlays = [...(mapOptions.overlays ?? [])];
  if (userLocation) overlays.push(userLocationOverlay(userLocation));
  // The exact options object handed to the runtime. It must reach
  // HatchMaps.mountMap as THIS object, never a spread copy, because
  // panTo steers the camera through it (see panTo below) — so this
  // implementation calls the runtime directly and inlines the two
  // fields the mountMap() helper would otherwise add by spreading
  // (clientId, onFatalError).
  const liveOptions = {
    ...mapOptions,
    // Engine-neutral base layer → this runtime's named styles:
    // "light" is the standard vector basemap, "esri-clarity" the
    // satellite-imagery style built from Esri World Imagery tiles.
    // The standard style is ALWAYS "light" (spec §15.2): the map is
    // shown in a light colour scheme even when the device is in
    // dark mode, so this must never switch to the runtime's "dark"
    // style (or be derived from prefers-color-scheme).
    baseStyle: baseLayer === 'satellite' ? 'esri-clarity' : 'light',
    ...(overlays.length > 0 ? { overlays } : {}),
    marker: (_place, index, selected) =>
      `<div class="pin${selected ? ' pin--on' : ''}">${index + 1}</div>`,
    onSelectPlace: index => highlight(index, true),
    clientId: 'artifact_web',
    onFatalError: onUnavailable,
  };
  if (!metaMapSupported()) {
    onUnavailable();
    return null;
  }
  const map = globalThis.HatchMaps.mountMap(container, liveOptions);
  if (map === null) return null;
  // The layer's own pin-tap detection (see above): wraps the
  // runtime handle so teardown removes the container listeners
  // whichever of destroy/remove the caller uses.
  const detachTapSelection = attachMetaMarkerTapSelection(
    container,
    map,
    highlight,
  );
  // The places this map was mounted with, in pin order: selectPlace
  // steers the camera to the selected place (see steerCamera).
  const placesList = Array.isArray(mapOptions.places)
    ? mapOptions.places
    : [];
  // Bumped on every camera steer and on teardown: a deferred
  // selection restore or re-steer whose token is stale does nothing.
  let panSeq = 0;
  // Steer the camera to `target`, leaving `restoreIndex` selected.
  //
  // Camera control on this runtime — the reason row taps used to
  // highlight the pin but never move the map. The runtime handle
  // exposes ONLY destroy() and selectPlace(index): there is no
  // panTo/getZoom on it, and an earlier implementation's
  // `map.panTo?.(target) ?? false` therefore returned false on every
  // tap, forever. (Verified against the bundled runtime: its
  // mountMap returns exactly { destroy, selectPlace }.)
  //
  // The one camera channel the runtime does have is its view state:
  // the component it renders re-reads `center` and `zoom` from the
  // exact options object it was mounted with (liveOptions) on every
  // render, and an inner effect jumpTo()s the live MapLibre map
  // whenever those values change. Steering therefore means: write
  // the target into liveOptions, then make a render happen that
  // cannot be skipped. Two measured failure modes shape HOW:
  //
  //   1. One tap behind (touch). A row tap reaches this layer twice:
  //      the row's native click listener (this layer's own, below)
  //      selects, then the app's React onClick pans. With touch
  //      input the runtime can flush the selection's render BETWEEN
  //      the two, while liveOptions.center still holds the PREVIOUS
  //      tap's target — the map then flies to the previous row's pin
  //      (the owner's "違う番号に飛ぶ"), and the pan that follows is
  //      lost to failure mode 2. Countermeasure: selectPlace writes
  //      the selected place's centre into liveOptions in the SAME
  //      call as the selection, so whichever render flushes first
  //      already carries the right centre.
  //   2. The bailout (any input). Toggling the selection away and
  //      back within one task batches into a single render whose
  //      final selection equals the current one; with the options
  //      object reference-identical, React skips the render entirely
  //      and the written centre is never read — a pan whose selection
  //      does not change (re-tapping the selected row after panning
  //      by hand, the 現在地 pan) silently did nothing. Reproduced
  //      in a real browser against this layer's real code.
  //      Countermeasure: the toggle steps the selection away NOW and
  //      restores it in a FOLLOWING task, so the render that reads
  //      the new centre is a genuine selection change.
  //
  // The zoom alternates by an invisible ±0.002 around the focus
  // zoom: the view effect keys on the zoom VALUE, so that refires it
  // even when the target equals the current centre. The runtime
  // offers no way to read the live zoom back, so a pan sets the
  // fixed focus zoom rather than preserving the viewer's zoom.
  // (selectPlace through the runtime handle does not fire
  // onSelectPlace, so none of this disturbs the row highlight; the
  // worst case is a one-frame pin flicker.)
  const steerCamera = (target, restoreIndex) => {
    liveOptions.center = { lat: target.lat, lng: target.lng };
    focusZoomFlip = !focusZoomFlip;
    liveOptions.zoom = FOCUS_ZOOM + (focusZoomFlip ? 0.002 : 0);
    const token = ++panSeq;
    const toggle = () => {
      try {
        map.selectPlace?.(restoreIndex === null ? 0 : null);
      } catch {
        /* the re-render trigger is best-effort */
      }
      setTimeout(() => {
        if (token !== panSeq) return;
        try {
          map.selectPlace?.(restoreIndex);
        } catch {
          /* the restore is best-effort */
        }
      }, 0);
    };
    toggle();
    // A pan issued while the MapLibre map does not exist yet (its
    // style is still loading — the canvas element is the tell) can
    // be consumed by a render that reaches no map. Re-steer on a
    // short ladder so the pan lands once the map is there; the
    // token keeps a newer pan from being overridden by the ladder.
    if (!container.querySelector('.maplibregl-canvas')) {
      [450, 1300].forEach(delay => {
        setTimeout(() => {
          if (token !== panSeq) return;
          focusZoomFlip = !focusZoomFlip;
          liveOptions.zoom = FOCUS_ZOOM + (focusZoomFlip ? 0.002 : 0);
          toggle();
        }, delay);
      });
    }
  };
  const teardown = fn => {
    panSeq += 1;
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
      selectedIndex = index;
      // Selecting a place also centres the camera on it, written in
      // the SAME call as the selection (steerCamera's note, failure
      // mode 1): on touch devices a render can flush between this
      // selection and the caller's own panTo, and that render must
      // already find this place's centre in liveOptions.
      const place =
        typeof index === 'number' ? placesList[index] : undefined;
      if (
        place &&
        typeof place.lat === 'number' &&
        typeof place.lng === 'number' &&
        Number.isFinite(place.lat) &&
        Number.isFinite(place.lng)
      ) {
        steerCamera({ lat: place.lat, lng: place.lng }, index);
      } else {
        try {
          map.selectPlace?.(index);
        } catch {
          /* selection is best-effort */
        }
      }
    },
    panTo(target) {
      if (
        !target ||
        typeof target.lat !== 'number' ||
        typeof target.lng !== 'number' ||
        !Number.isFinite(target.lat) ||
        !Number.isFinite(target.lng)
      ) {
        return false;
      }
      // Steer to an arbitrary target (the viewer's own position is
      // the caller that is not a place in the list), keeping the
      // current selection. How this works — and why it is built the
      // way it is — is steerCamera's note above.
      steerCamera(
        { lat: target.lat, lng: target.lng },
        selectedIndex,
      );
      return true;
    },
    getZoom() {
      // The runtime handle has no getZoom; the only zoom this layer
      // ever knows is the focus zoom panTo set itself.
      return liveOptions.zoom ?? null;
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
