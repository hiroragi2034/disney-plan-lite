// 我が家のディズニー計画 v0.1
//
// TAB1 (fixed) AI chat / TAB2 (fixed) conditions form / TAB3+ one tab per
// plan-generation run, each with sub-tabs プランA｜プランB｜プランC
// (プランA selected when the tab opens).
// On a plan tab the OpenStreetMap-based map (numbered pins in route order)
// is fixed in the top ~32% of the screen and the plan summary + timeline
// scroll below it. A fixed AI instruction form sits at the bottom on every
// tab and feeds the TAB1 conversation.

import {
Fragment,
useCallback,
useEffect,
useRef,
useState,
type FormEvent,
type KeyboardEvent,
type ReactNode,
type RefObject,
type CSSProperties,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";
import { buildPlanPdf } from "./pdf";
import {
TIGHT_LEG_CAUTION_TEXT,
crowdFactorLabel,
crowdScenarioPremiseText,
formatWalkDistance,
tightLegTargets,
} from "./plan_metrics";
import "./hatch-maps.js";
import "./hatch-maps.css";
import { buildStaticMapUrl, mountPlaceListMap } from "./map_helpers.mjs";

// Input limits (maxLength / min / max / required …) are read from
// the server actions' request schemas at build time, so a form
// input and the action it feeds can never disagree about a limit.
const FIELDS = actionFields<typeof Actions>();

type State = ApiResponse<typeof api, "getState">;
type Conditions = State["conditions"];
type PlanSet = State["planSets"][number];
type Plan = PlanSet["plans"][number];
type PlanItem = Plan["items"][number];

type TabKey = "chat" | "conditions" | "waitsources" | "help" | "debug" | "taskmgr" | number;

// What the client reports to the AI with each message from the bottom
// form: the tab open at send time. The AI resolves plan references
// （「プランB」 etc.) against the plan set open in that tab — and, for
// a plan-set tab, against the A/B/C slot selected in it.
type OpenTabArg =
  | { kind: "chat" | "conditions" | "waitsources" | "help" }
  | { kind: "planSet"; planSetId: number; slot: SubTab };
type WaitTimeSource = State["waitTimeSources"][number];
type SubTab = "A" | "B" | "C";

// A same-day set's inputs, carried from its 条件 panel's
// 「条件を変えて再検索」 into the プラン作成 tab's 当日検索 section
// as initial values. Unlike a standard set's conditions these are
// NOT written into the saved conditions form — the 当日検索 form
// carries its own values by design — so they travel through the
// App shell as a one-shot prefill, consumed (and cleared) when the
// form mounts with them.
type SameDayPrefill = {
  park: "land" | "sea";
  location: string;
  startTime: string;
  adults: number;
  children: number;
  childrenAges: string;
  budgetJpy: number | null;
  walkingSpeed: Conditions["walkingSpeed"];
  request: string;
};

const PLAN_COLORS: Record<"A" | "B" | "C", string> = {
  A: "var(--plan-a)",
  B: "var(--plan-b)",
  C: "var(--plan-c)",
};

const KIND_LABELS: Record<PlanItem["kind"], string> = {
  attraction: "アトラクション",
  show: "ショー",
  parade: "パレード",
  restaurant: "食事",
  break: "休憩",
  move: "移動",
  other: "その他",
  purchase: "購入",
  first10: "最初の10分",
};

// One colour per schedule-row kind, so the type of each stop reads at a
// glance. Fixed hues with white chip text work in both colour schemes.
const KIND_COLORS: Record<PlanItem["kind"], string> = {
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

// Handle to the mounted map. selectPlace highlights a pin; panTo moves
// the camera on the LIVE map with an animated pan (easeTo with a new
// centre only), so the zoom the user currently has is preserved —
// the map is never remounted to move it. panTo returns false while the
// map is still initialising, so callers may retry once.
type MapController = {
  selectPlace?: (index: number) => void;
  panTo?: (target: { lat: number; lng: number }) => boolean;
  getZoom?: () => number | null;
  refreshSize?: () => void;
};

// Desktop horizontal scrolling for the overflow-x-auto tab strips.
// On touch devices the strips already scroll natively, and this hook
// deliberately ignores touch pointers so that behaviour (including
// long-press on plan tabs) is untouched. For mouse users it adds:
// - wheel: a vertical wheel over the strip scrolls it sideways
//   (Shift+wheel arrives as deltaX and is honoured as-is); the event
//   is only swallowed while the strip can still move that way, so at
//   the ends the wheel falls through to the page as before.
// - drag: press and drag sideways to scroll; once the pointer has
//   moved past a small threshold the drag captures the pointer, the
//   click that follows is swallowed (so a drag never activates the
//   tab it started on), and onDragStart fires (the main tab bar uses
//   it to cancel a pending long-press delete).
