# Data Plan

## Context provenance
- `仕様書の内容を一切変えず、そのまま実装してください` (verbatim build request; the spec file ~/workspace/disney-app/distribution-lite/disney-plan-lite-spec.md is the sole authority — read in full, sections 0–14)
- Spec §13 initial state: fixed tabs 4, plan-set tabs 0, conversations 0, facility dictionary 75 (§4.1 table), area travel times 22 (§4.2 table), wait-time reference sites 6 (§4.3 table); facts and snapshots empty at start.
- Parent conversation confirms: map fixed on screen (§2), official-page links on schedule rows from the facility dictionary (§2/§4), heading 「重視する点（3プラン共通）」 with 4-row default textarea and the detailed placeholder example (§3), full-width layout when the map is a right column on wide screens (§2).

## Tested sources
### Specification file (authoritative data)
**Used by**: seed data (facilities/travel times/sites), all server actions, client UI copy and rules
**Test command**: `muse.read ~/workspace/disney-app/distribution-lite/disney-plan-lite-spec.md` (full read in 3 chunks, sections 0–14)
**Sample output**: §4.1 facility table (75 rows with park/area/lat/lng/official URL/duration, e.g. ソアリン sea 35.627691,139.885425 https://www.tokyodisneyresort.jp/tds/attraction/detail/219/ 5分); §4.2 travel-time table (22 rows with sources); §4.3 reference sites (6 rows); §5–§9 generation/facts/gate rules; §10 chat judgment rules; §11 task management (180s/2400s/3 attempts for plan creation); §12 prompt frames; §13 initial-state counts.
**Processing**: Seed rows are inserted verbatim from the spec tables by a migration-time seed action guarded to run only when tables are empty; URLs copied byte-for-byte from the spec. No other external dataset is seeded.

## Runtime sources (fetched by the app itself, per spec §5–§6)
### Tokyo Disney Resort official site
**Delivered by**: generation task via ctx.agent.spawnTask (browser fetch; text-only fetch never becomes canon per §5.2), snapshots stored raw with fetch method recorded
**Checked with**: spec §5.1 page list (DPA guide, facility lists, dated daily page, monthly calendar/tickets, restaurant detail pages, tdr/news/update.html) and §5.2 completeness gate (zero-or-100)
### Wait-time reference sites (§4.3, 6 sites)
**Delivered by**: congestion/wait research step of the generation task; used only as estimation material, never for official cross-checks (§4.3)
**Checked with**: spec §6 priority rules (external congestion forecast primary, seasonal statistics auxiliary)
### OpenStreetMap Nominatim
**Delivered by**: generation task only for coordinates of new facilities missing from the dictionary (§4.1), candidates restricted to the park bounding boxes in the spec
**Checked with**: spec §4.1 coordinate range checks (land lat 35.618–35.652, sea lat 35.608–35.645, lng 139.862–139.902)
### OpenStreetMap map tiles
**Delivered by**: client map on plan tabs via this app's hatch-maps mechanism (platform map component); pins only for rows with coordinates, numbered in time order (§2). If the platform map cannot run, a Meta static-map image of the same pins is the fallback.
**Checked with**: maps reference pattern (real interactive map, not hand-drawn)

## UI parts port (2026-11-24 edit)
- Client UI rebuilt from `~/workspace/disney-app/distribution-lite/ui-parts/` (PARTS.md + 17 part files cut from the home app) and spec §15: theme.css is byte-identical to part 01; index.html follows part 02 (title; the root slug attribute stays this artifact's own). All other parts were adapted to this server's existing action/response shapes — server code untouched.
- Not carried (reported in the build report): the home map layer's vendored-Leaflet engine (this app has no Leaflet files; the map runs on hatch-maps only, with the static-image fallback), PDF buttons/preview, facility photos, same-day search UI/tabs, debug/task-manager tabs, and home-only displays whose data this server does not return (per-plan progress, restaurant classification, wait-site check metadata, prompt version, verification package, 「条件を変えて再検索」 — no save-only conditions action exists here).

## Long-term data behavior
- **Refresh policy**: Canonical snapshots reusable within 3 hours except the dated daily page, which is fetched fresh every generation (§5.2). Facts are rebuilt per generation run; the gate always references the newest complete fact set of that run (§9.1). Congestion forecasts are reused per park+date once decided (§6).
- **Growth**: One plan-set tab per generation; past sets persist. Conversations append; list reads always keep the newest side (§4). Dictionary/travel-time rows may accumulate only with sourced evidence (§4.2).
- **Ordering**: Tabs: チャット, プラン作成, 待ち時間参考サイト, もっとこうして！, then plan sets in creation order; duplicate set titles get (2), (3)… prefixes (§2). Messages displayed in chronological order.
- **Time semantics**: All times are park-local wall-clock HH:MM on the visit date; generation start timestamps are server-recorded so elapsed-time display survives reload (§11.1); progress lines are written on the server clock every minute.

## Rejected approaches
- **Tried**: Treating the spec as a loose brief and designing a simpler planner
  **Why rejected**: The build request explicitly forbids changing the spec; every rule (gate conditions §9.2, chat judgment §10/§12.1, task limits §11.2, verbatim copy §1) is implemented as written.
- **Tried**: Text-only fetch as the canon source for official pages
  **Why rejected**: §5.2 forbids it — browser fetch only; if the browser route fails, generation fails visibly rather than silently downgrading.

Imagery: no facility photos (§14 excludes photo display in this version); the only visuals are the OSM map and UI. No build-time image sourcing needed.
