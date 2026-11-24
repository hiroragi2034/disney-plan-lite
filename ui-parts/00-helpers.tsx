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

function formatDateLabel(iso: string | null): string {
  if (!iso) return "日付未定";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()] ?? "";
  return `${d.getMonth() + 1}/${d.getDate()}（${weekday}）`;
}

// An ISO instant -> "M/D" on the park's calendar (Asia/Tokyo), for
// the 作成/最終検証 dates shown on a plan set.
function formatMonthDayJst(iso: string | null): string {
  if (!iso) return "―";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "―";
  return d.toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
  });
}

// Generation phase durations, recorded by the generation task:
// seconds rendered as 分/秒 so the breakdown reads at a glance.
function formatPhaseSeconds(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return `${total}秒`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s > 0 ? `${m}分${s}秒` : `${m}分`;
}

function parkLabel(park: "land" | "sea"): string {  return park === "land" ? "ランド" : "シー";
}

// Spec-change suspicion （仕様変更の疑い）: an unverified entry
// concerns the app's premises about Disney's current system (DPA
// eligibility/prices, the normalized facts, park hours, show
// times, closures, ticket prices) — travel-leg entries （移動時間・
// 座標） do not count (a data gap, not a system change). Mirrors
// the server-side predicate in actions.ts. Wherever such a
// detection is displayed, the display itself carries the repair
// guidance (the owner's rule: the help tab alone is not read) —
// the fix is asked of the owner's own Muse in the main chat,
// because the in-app AI cannot change the app.
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

