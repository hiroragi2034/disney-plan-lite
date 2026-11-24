// 我が家のディズニー計画（最小版）
//
// TAB1 (fixed) AI chat / TAB2 (fixed) conditions form / TAB3 (fixed)
// wait-time reference sites / TAB4 (fixed) もっとこうして！ / then one
// tab per plan-generation run, each with sub-tabs 条件｜A｜B｜C
// (プランA selected when the tab opens).
// On a plan tab the map is fixed below the switcher (phone: a band of
// ~32% of the screen height; wide screens: the right column) and the
// plan summary + timeline scroll below / beside it. A fixed AI
// instruction form sits at the bottom on every tab and feeds the
// TAB1 conversation.

import {
useEffect,
useRef,
useState,
type FormEvent,
type KeyboardEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";
import { PlanSetView } from "./PlanSetView";

// Input limits (maxLength / min / max / required …) are read from
// the server actions' request schemas at build time, so a form
// input and the action it feeds can never disagree about a limit.
const FIELDS = actionFields<typeof Actions>();

type State = ApiResponse<typeof api, "getState">;
type Condition = NonNullable<State["savedCondition"]>;
type SubTab = "A" | "B" | "C";

type Tab =
  | { type: "chat" }
  | { type: "form" }
  | { type: "sites" }
  | { type: "more" }
  | { type: "set"; id: number };

// ---------------------------------------------------------------- helpers

// Desktop horizontal scrolling for the overflow-x-auto tab strips.
// On touch devices the strips already scroll natively, and this hook
// deliberately ignores touch pointers so that behaviour is untouched.
// For mouse users it adds:
// - wheel: a vertical wheel over the strip scrolls it sideways
//   (Shift+wheel arrives as deltaX and is honoured as-is); the event
//   is only swallowed while the strip can still move that way, so at
//   the ends the wheel falls through to the page as before.
// - drag: press and drag sideways to scroll; once the pointer has
//   moved past a small threshold the drag captures the pointer and
//   the click that follows is swallowed (so a drag never activates
//   the tab it started on).
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

function parkLabel(park: "land" | "sea"): string {
  return park === "land" ? "ランド" : "シー";
}

// The value handed to a time select: only the zero-padded "HH:MM"
// form is a valid value there. Anything that is not an H:MM time
// passes through as-is.
function toTimeInputValue(v: string | null | undefined): string {
  if (!v) return "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return v;
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

// Bounded time-of-day select. A native <input type="time"> offers
// all 24 hours, so nonsense like a 0:00 park entry was selectable.
// The forms offer only a plausible window in 15-minute steps
// (callers pass the window), headed by 「未定」. A stored value
// outside the offered window is kept as its own option, so an
// existing value never renders blank or is silently replaced.
function TimeSelect({
  id,
  value,
  onChange,
  className,
  startMin,
  endMin,
  ariaLabel,
}: {
  id: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  className: string;
  // Minutes from midnight for the first / last offered time.
  startMin: number;
  endMin: number;
  ariaLabel?: string;
}) {
  const v = toTimeInputValue(value);
  const stepped: string[] = [];
  for (let m = startMin; m <= endMin; m += 15) {
    stepped.push(
      `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
    );
  }
  const options =
    v && !stepped.includes(v) ? [...stepped, v].sort() : stepped;
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      className={className}
      value={v}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">未定</option>
      {options.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------- chat

function ChatView({
  messages,
  sending,
  pendingText,
  onGoForm,
}: {
  messages: State["messages"];
  // While a send is in flight: the just-sent message (shown immediately so
  // the tab switch reads as "my message went through") and the thinking
  // indicator below it.
  sending: boolean;
  pendingText: string | null;
  onGoForm: () => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, sending]);

  return (
    // overflow-x-hidden + overflow-wrap:anywhere (inherited by every
    // bubble): assistant replies carry long unbroken source URLs, and
    // with only whitespace-pre-wrap those URLs refused to wrap, widened
    // this scroll region at phone width and made the whole chat tab
    // scroll sideways. Horizontal scrolling stays confined to the tab
    // strip; tab content never scrolls sideways.
    <div ref={listRef} className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 pb-4 pt-3 [overflow-wrap:anywhere]">
      {/* Guide, always at the top of the chat tab: start from the conditions
          tab, ask this AI anything via the bottom form, and take complaints
          about the app itself to Muse in the main chat. */}
      <div className="rounded-[var(--radius)] bg-[var(--surface-alt)] px-4 py-4">
        <p className="font-display text-base font-bold">
          当日あたふたしないために、前日までに全部決める。
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          ディズニーの複雑なシステムを踏まえた上で、AIが最適なプランを３つ同時に提案します。常に『今のディズニー』に合わせたプランを提案できます。
        </p>
        <ol className="mt-3 space-y-2.5 text-sm leading-relaxed">
          <li>
            <span className="font-semibold">1. まずは「プラン作成」タブから。</span>
            条件を入れて「この条件で3プランを作成」を押してください。
          </li>
          <li>
            <span className="font-semibold">2. 相談・作り直し・調べ物は、この画面（AIチャット）で。</span>
            プランの相談・作り直し・制度や施設の調べ物ができます。画面下のフォームからAIに指示してください。
          </li>
          <li>
            <span className="font-semibold">3. これはあなた専用のアプリです。</span>
            アプリ自体を変更する事もできます。機能の追加や修正などなんでもMuseのメインチャットでAIに伝えてください。この画面のAIは計画づくり専用です。
          </li>
        </ol>
        <button
          type="button"
          onClick={onGoForm}
          className="mt-4 w-full rounded-full bg-[var(--accent)] px-4 py-2.5 text-base font-bold text-[var(--accent-text)]"
        >
          まずはプラン作成
        </button>
      </div>

      {messages.length === 0 && !sending ? null : (
        <ol className="mt-4 min-w-0 space-y-3">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`flex min-w-0 ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`min-w-0 max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed [overflow-wrap:anywhere] ${
                  m.role === "user"
                    ? "bg-[var(--accent)] text-[var(--accent-text)]"
                    : "bg-[var(--surface)] border border-[var(--border)]"
                }`}
              >
                {m.text}
              </div>
            </li>
          ))}
          {sending ? (
            <>
              {pendingText ? (
                <li className="flex min-w-0 justify-end">
                  <div className="min-w-0 max-w-[85%] whitespace-pre-wrap rounded-2xl bg-[var(--accent)] px-3.5 py-2.5 text-[15px] leading-relaxed text-[var(--accent-text)] opacity-80 [overflow-wrap:anywhere]">
                    {pendingText}
                  </div>
                </li>
              ) : null}
              <li className="flex justify-start">
                <div
                  role="status"
                  className="flex items-center gap-2.5 rounded-2xl border-2 border-[var(--accent)] bg-[var(--surface)] px-4 py-3 shadow-md"
                >
                  <span aria-hidden className="flex items-end gap-1">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </span>
                  <span className="text-base font-bold">
                    AIが返信を考えています…
                  </span>
                </div>
              </li>
            </>
          ) : null}
        </ol>
      )}

      {/* Scope notices: footnotes pinned to the very bottom of the chat
          tab (after the message list when it overflows). */}
      <div className="mt-auto px-1 pt-6 text-xs leading-relaxed text-[var(--dim)]">
        <p>※このアプリはDPAの販売状況は取得できません。</p>
        <p className="mt-1">足りない機能は、あなたのClaudeに追加してもらえます。</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- conditions form

const PRIORITY_PLACEHOLDER = `例：
・美女と野獣は絶対に乗りたい。できればDPAで
・プーさんは子どもと一緒に。絶叫系は全員苦手なので入れない
・昼食は座れる店で12時台に。子どもが昼寝しそうなら、その間に大人は交代で1つ乗る
・夕食は17時台に早めに済ませたい
・帰る前に30分、お土産を見る時間を残して`;

const WALK_SPEEDS = [
  [55, "ゆっくり"],
  [70, "少しゆっくり"],
  [85, "少し急いで"],
  [100, "急いで"],
] as const;

function ConditionForm({
  saved,
  onStarted,
}: {
  saved: Condition | null;
  onStarted: (setId: number) => void;
}) {
  const queryClient = useQueryClient();
  const [park, setPark] = useState<"sea" | "land">(saved?.park ?? "sea");
  const [date, setDate] = useState(saved?.visitDate ?? "");
  const [entryTime, setEntryTime] = useState<string | null>(saved?.entryTime ?? null);
  const [exitTime, setExitTime] = useState<string | null>(saved?.exitTime ?? null);
  // The numeric fields （予算・大人・子ども） hold the typed STRING
  // while editing: a field can be cleared with backspace and stay
  // empty — empty means 未入力 — and the text is parsed into numbers
  // only when the create button is pressed.
  const [budget, setBudget] = useState(saved ? String(saved.budget) : "");
  const [adults, setAdults] = useState(saved ? String(saved.adults) : "");
  const [childCount, setChildCount] = useState(saved ? String(saved.children.length) : "0");
  const [children, setChildren] = useState<{ age: string; height: string }[]>(
    saved ? saved.children.map((c) => ({ age: String(c.age), height: c.heightCm != null ? String(c.heightCm) : "" })) : [],
  );
  const [priority, setPriority] = useState(saved?.priority ?? "");
  const [walkSpeed, setWalkSpeed] = useState(saved?.walkSpeed ?? 70);
  const [error, setError] = useState<string | null>(null);
  const initedRef = useRef(false);
  useEffect(() => {
    if (saved && !initedRef.current) {
      initedRef.current = true;
      setPark(saved.park);
      setDate(saved.visitDate);
      setEntryTime(saved.entryTime);
      setExitTime(saved.exitTime);
      setBudget(String(saved.budget));
      setAdults(String(saved.adults));
      setChildCount(String(saved.children.length));
      setChildren(saved.children.map((c) => ({ age: String(c.age), height: c.heightCm != null ? String(c.heightCm) : "" })));
      setPriority(saved.priority);
      setWalkSpeed(saved.walkSpeed);
    }
  }, [saved]);

  const start = useMutation({
    mutationFn: async (cond: Condition) => await api.startFromForm({ condition: cond }),
    onSuccess: (res) => {
      queryClient.invalidateQueries();
      onStarted(res.setId);
    },
    onError: (e) => setError(e instanceof Error ? e.message : "作成を開始できませんでした。"),
  });

  // Press-time handling for 「この条件で3プランを作成」: the numeric
  // texts are parsed here, and only here. Adults unentered or 0 and
  // budget unentered or 0 stop the press with the reason shown in
  // place; generation never starts. Children unentered or 0 fix the
  // party at 0 children and never block.
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    const adultsNum = adults.trim() === "" ? NaN : Number(adults);
    const budgetNum = budget.trim() === "" ? NaN : Number(budget);
    if (!date) return setError("日付を入力してください。");
    if (Number.isNaN(adultsNum) || adultsNum < 1) return setError("大人の人数が未入力または0のため、作成を開始できません。");
    if (Number.isNaN(budgetNum) || budgetNum < 1) return setError("予算が未入力または0のため、作成を開始できません。");
    const nChild = Math.max(0, Math.min(20, Number(childCount) || 0));
    const childList = Array.from({ length: nChild }, (_, i) => {
      const c = children[i];
      return { age: c && c.age.trim() !== "" ? Number(c.age) : 0, heightCm: c && c.height.trim() !== "" ? Number(c.height) : null };
    });
    start.mutate({
      park,
      visitDate: date,
      entryTime,
      exitTime,
      budget: Math.floor(budgetNum),
      adults: Math.floor(adultsNum),
      children: childList,
      priority,
      walkSpeed,
    });
  };

  const nChild = Math.max(0, Math.min(20, Number(childCount) || 0));
  const inputCls =
    "w-full min-w-0 max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base";
  const labelCls = "block text-sm font-semibold";
  const hintCls = "mt-1 text-xs text-[var(--dim)]";

  return (
    <form
      className="min-h-0 w-full min-w-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-4 pb-6 pt-3"
      onSubmit={submit}
    >
      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5">
        <p className="font-display text-base font-bold">プランの作り方</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-relaxed">
          <li>
            「重視する点」は<strong>1つだけ</strong>です。書いた内容は3プラン全てに共通して反映されます。
          </li>
          <li>
            3プランは、対象日の<strong>混雑の見通し</strong>で分けて作ります。混雑予想は、曜日・時期・過去の混雑データからアプリ側が判断します（選ぶ項目はありません）。
          </li>
          <li>
            プランA＝<strong>激混み前提</strong>（予想より混む側）、プランB＝<strong>やや混み前提</strong>（予想どおり）、プランC＝<strong>思ったより空いてる前提</strong>（予想より空く側）。当日の実際の混み具合に近い前提のプランを選んで使えます。
          </li>
        </ul>
      </div>

      <fieldset className="min-w-0">
        <legend className={labelCls}>パーク</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="パーク選択">
          {(
            [
              { value: "land", label: "ディズニーランド" },
              { value: "sea", label: "ディズニーシー" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={park === opt.value}
              onClick={() => setPark(opt.value)}
              className={`rounded-[var(--radius)] border px-3 py-2.5 font-display text-base font-bold ${
                park === opt.value
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)]"
                  : "border-[var(--border)] bg-[var(--surface)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="min-w-0">
        <legend className={labelCls}>歩く速さ</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="歩く速さの選択">
          {WALK_SPEEDS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={walkSpeed === v}
              onClick={() => setWalkSpeed(v)}
              className={`rounded-[var(--radius)] border px-2 py-2.5 text-sm font-bold ${
                walkSpeed === v
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)]"
                  : "border-[var(--border)] bg-[var(--surface)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className={hintCls}>
          施設間の移動時間は、この速さと施設間の距離から計算します（直線距離が下限で、距離に応じた迂回と余裕を加えます）。
        </p>
      </fieldset>

      {/* Date / entry / exit row. On phones the three fields STACK,
          each on its own full-width row (spec §3); from sm up the
          three sit side by side. The matching appearance reset for
          phone widths lives in theme.css. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="min-w-0">
          <label htmlFor="visit-date" className={labelCls}>日付</label>
          <input
            {...FIELDS.startFromForm.condition.visitDate}
            id="visit-date"
            type="date"
            aria-label="日付"
            className={inputCls}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="entry-time" className={labelCls}>入園時刻</label>
          <TimeSelect
            id="entry-time"
            ariaLabel="入園時刻"
            className={inputCls}
            value={entryTime}
            onChange={setEntryTime}
            startMin={8 * 60 + 45}
            endMin={21 * 60}
          />
          <p className={hintCls}>
            入園できる最速は8:45（ハッピーエントリー）です。それより前の時刻は選べません
          </p>
        </div>
        <div className="min-w-0">
          <label htmlFor="exit-time" className={labelCls}>退園時刻</label>
          <TimeSelect
            id="exit-time"
            ariaLabel="退園時刻"
            className={inputCls}
            value={exitTime}
            onChange={setExitTime}
            startMin={9 * 60}
            endMin={22 * 60 + 30}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="min-w-0">
          <label htmlFor="budget" className={labelCls}>予算（円）</label>
          <input
            {...FIELDS.startFromForm.condition.budget}
            id="budget"
            type="text"
            inputMode="numeric"
            placeholder="例：50000"
            aria-label="予算（円・チケット代込みの総額）"
            className={inputCls}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
          <p className={hintCls}>チケット代込みの総額で入力してください</p>
        </div>
        <div className="min-w-0">
          <label htmlFor="adults" className={labelCls}>大人（人）</label>
          <input
            {...FIELDS.startFromForm.condition.adults}
            id="adults"
            type="text"
            inputMode="numeric"
            placeholder="例：2"
            aria-label="大人人数"
            className={inputCls}
            value={adults}
            onChange={(e) => setAdults(e.target.value)}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="child-count" className={labelCls}>子ども（人）</label>
          <input
            id="child-count"
            type="text"
            inputMode="numeric"
            aria-label="子ども人数"
            className={inputCls}
            value={childCount}
            onChange={(e) => setChildCount(e.target.value)}
          />
        </div>
      </div>

      {nChild > 0 && (
        <div className="space-y-2">
          {Array.from({ length: nChild }, (_, i) => (
            <div key={i} className="flex items-end gap-2">
              <span className="pb-2.5 text-sm font-medium">子ども{i + 1}</span>
              <label className="flex-1 text-xs text-[var(--dim)]">
                年齢
                <input
                  aria-label={`子ども${i + 1}の年齢`}
                  type="text"
                  inputMode="numeric"
                  value={children[i]?.age ?? ""}
                  onChange={(e) => setChildren((prev) => { const next = [...prev]; next[i] = { age: e.target.value, height: next[i]?.height ?? "" }; return next; })}
                  className={`${inputCls} mt-0.5`}
                />
              </label>
              <label className="flex-1 text-xs text-[var(--dim)]">
                身長（cm・任意）
                <input
                  aria-label={`子ども${i + 1}の身長`}
                  type="text"
                  inputMode="numeric"
                  value={children[i]?.height ?? ""}
                  onChange={(e) => setChildren((prev) => { const next = [...prev]; next[i] = { age: next[i]?.age ?? "", height: e.target.value }; return next; })}
                  className={`${inputCls} mt-0.5`}
                />
              </label>
            </div>
          ))}
        </div>
      )}

      <div>
        <label htmlFor="priority" className={labelCls}>重視する点（3プラン共通）</label>
        <textarea
          {...FIELDS.startFromForm.condition.priority}
          id="priority"
          rows={4}
          placeholder={PRIORITY_PLACEHOLDER}
          className={`${inputCls} leading-relaxed`}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        />
        <p className={hintCls}>
          ここに書いたことは、混雑シナリオで分かれる3プランの全てに共通して反映されます。
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={start.isPending}
          className="rounded-full bg-[var(--accent)] px-5 py-2.5 font-display text-base font-bold text-[var(--accent-text)] disabled:opacity-50"
        >
          {start.isPending ? "開始しています…" : "この条件で3プランを作成"}
        </button>
      </div>

      <p className="text-xs leading-relaxed text-[var(--dim)]">
        プランは作成のたびに公式サイトでその日の情報を確認して作ります（作成には10〜20分ほどかかります）。フォームの項目そのものを増減したいときは、Museのメインチャットで「このアプリに◯◯を追加して」と指示してください。この画面のAIは計画づくり専用です。
      </p>
    </form>
  );
}

// ------------------------------------------------------- wait-time sources

// Fixed tab (same rank as AIチャット / プラン作成, never deletable): a
// display-only list of the registered wait-time reference sites. There
// is deliberately NO add/edit form here — additions, removals and
// re-searches are instructed to the AI through the bottom form, and the
// AI does the searching, checking and registering.
function SitesView({ sites }: { sites: State["waitSites"] }) {
  const parkBadge = (park: string): string =>
    park === "land" ? "ランド" : park === "sea" ? "シー" : "両パーク";
  return (
    <div className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-6 pt-3 [overflow-wrap:anywhere]">
      <div className="rounded-[var(--radius)] bg-[var(--surface-alt)] px-4 py-4">
        <p className="font-display text-base font-bold">
          待ち時間の推定に使う、実績データの参考サイト
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          待ち時間の公式データはありません。プラン作成のときは、ここに登録された民間の集計サイト（公式の表示待ち時間を記録・集計したもの）を材料に、典型的な待ち時間を推定します。使ったサイトは、公式の出典とは分けて、各プランの「プランの説明」に残ります。
        </p>
        <p className="mt-2 text-sm font-semibold leading-relaxed">
          参考サイトの追加・削除・再検索は、画面下のフォームからAIに指示してください。
        </p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          例：「○○を参考サイトに追加して」「△△を削除して」「待ち時間の参考サイトを探し直して」
        </p>
      </div>

      {sites.length === 0 ? (
        <p className="mt-5 rounded-[var(--radius)] border border-dashed border-[var(--border)] px-3 py-3 text-sm leading-relaxed text-[var(--dim)]">
          現在、登録されている参考サイトはありません。画面下のフォームから「待ち時間の参考サイトを探して登録して」とAIに指示してください。
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {sites.map((s) => (
            <li
              key={s.id}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3"
            >
              <p className="flex flex-wrap items-center gap-2">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener"
                  className="text-base font-semibold text-[var(--accent)] underline underline-offset-2"
                >
                  {s.name}
                </a>
                <span className="rounded-full bg-[var(--surface-alt)] px-2 py-0.5 text-xs font-semibold text-[var(--dim)]">
                  {parkBadge(s.park)}
                </span>
              </p>
              <p className="mt-0.5 break-all text-xs text-[var(--dim)]">
                {s.url}
              </p>
              {s.provides ? (
                <p className="mt-1.5 text-sm leading-relaxed">{s.provides}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------- help / customize

// Fixed tab (same rank as AIチャット / プラン作成 / 待ち時間参考サイト,
// never deletable): a display-only guide explaining that this app
// itself can be reshaped to the user's liking — not from the in-app
// AI chat at the bottom of the screen (that AI makes and edits plans
// only), but by asking Muse in the main chat, the usual conversation
// screen outside this app. There is deliberately NO "go to main chat"
// button: the app runs inside a sandboxed frame with no route back to
// the Muse shell's conversation screen, so a button could not take
// the user anywhere real. Instead the tab gives the concrete steps
// and ready-to-send example sentences with copy buttons.
const CUSTOMIZE_EXAMPLES: { wish: string; instruction: string }[] = [
  {
    wish: "プランにメモを入れられるようにして",
    instruction: "我が家のディズニー計画に、プランへメモを入れられる機能を追加して",
  },
  {
    wish: "よく使う条件を保存できるようにして",
    instruction: "我が家のディズニー計画で、よく使う条件を保存できるようにして",
  },
  {
    wish: "一度に5個プランを作れるようにして",
    instruction: "我が家のディズニー計画で、一度に5個のプランを作れるようにして",
  },
];

function MoreView({ counts }: { counts: State["counts"] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const resetMutation = useMutation({
    mutationFn: async () => await api.resetAllData({}),
    onSuccess: () => {
      setResetConfirming(false);
      setResetDone(true);
      queryClient.invalidateQueries();
    },
  });

  const copyText = async (text: string) => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Clipboard API can be unavailable inside a WebView; fall back
      // to the classic hidden-textarea copy.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(text);
      window.setTimeout(() => {
        setCopied((cur) => (cur === text ? null : cur));
      }, 2500);
    }
  };

  return (
    <div className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-6 pt-3 [overflow-wrap:anywhere]">
      <div className="rounded-[var(--radius)] bg-[var(--surface-alt)] px-4 py-4">
        <p className="font-display text-lg font-bold leading-snug">
          このアプリは、あなた好みに作り替えられます
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          「こんな機能があったらいいのに」と思ったら、そのままMuseにお願いできます。このアプリの機能の追加や変更は、アプリの外にあるMuseのメインチャット（いつもの会話画面）で指示するだけです。プログラミングの知識は要りません。思ったことを、普段の言葉で伝えてください。
        </p>
      </div>

      <div className="mt-5">
        <p className="font-display text-base font-bold">
          画面下のAIと、メインチャットの違い
        </p>
        <div className="mt-2.5 space-y-2.5">
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3">
            <p className="text-sm font-bold">
              画面下のAIチャット（このアプリの中）
            </p>
            <p className="mt-1 text-sm leading-relaxed">
              プランの作成や変更のためのAIです。「プランBをもっとゆっくり回る感じにして」「この乗り物が取れなかったので組み直して」といった、計画づくりのお願いはこちらへ。
            </p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
              アプリの機能そのものを増やしたり変えたりはできません。
            </p>
          </div>
          <div className="rounded-[var(--radius)] border-2 border-[var(--accent)] bg-[var(--surface)] px-3.5 py-3">
            <p className="text-sm font-bold">
              Museのメインチャット（このアプリの外）
            </p>
            <p className="mt-1 text-sm leading-relaxed">
              アプリ自体を作り替えるための指示はこちらへ。機能の追加・変更、入力フォームの項目の増減、画面の見せ方の変更など、自由にお願いできます。
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <p className="font-display text-base font-bold">
          たとえば、こんなお願いができます
        </p>
        <ul className="mt-2.5 space-y-2.5">
          {CUSTOMIZE_EXAMPLES.map((ex) => (
            <li
              key={ex.wish}
              className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3"
            >
              <p className="text-base font-semibold leading-snug">
                「{ex.wish}」
              </p>
              <p className="mt-2 text-xs font-semibold text-[var(--dim)]">
                メインチャットに送る文面（そのまま使えます）
              </p>
              <p className="mt-1 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-sm leading-relaxed">
                {ex.instruction}
              </p>
              <button
                type="button"
                onClick={() => copyText(ex.instruction)}
                aria-label={`「${ex.instruction}」をコピー`}
                className="mt-2 rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-bold text-[var(--accent-text)]"
              >
                {copied === ex.instruction ? "コピーしました" : "この文面をコピー"}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2.5 text-sm leading-relaxed text-[var(--dim)]">
          このほかにも、プラン作成フォームの項目を増やす・減らす、新しいタブを追加する、ボタンの名前や並びを変えるなど、自由に機能を追加・変更できます。「こうだったら使いやすいのに」と感じたことを、そのまま言葉にしてお願いしてみてください。
        </p>
      </div>

      <div className="mt-5">
        <p className="font-display text-base font-bold">お願いする手順</p>
        <ol className="mt-2.5 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
          <li>
            アプリ（または muse.ai）を開いて、いつもの会話画面（メインチャット）を開きます。このアプリの中で話している画面ではなく、アプリの外の、いつもClaudeと話している画面です。
          </li>
          <li>
            上の例から近いものをコピーして貼り付けるか、自分の言葉で「我が家のディズニー計画に、○○できるようにして」と書いて送ります。
          </li>
          <li>
            変更が終わったら、このアプリに戻って確認してください。作り替えた内容がそのまま反映されています。
          </li>
        </ol>
        <p className="mt-3 rounded-[var(--radius)] bg-[var(--surface-alt)] px-3.5 py-2.5 text-sm leading-relaxed">
          この画面からメインチャットへ直接移動するボタンはありません。お手数ですが、アプリを開いて、いつもの会話画面から指示してください。
        </p>
      </div>

      <div className="mt-8 border-t border-[var(--border)] pt-5">
        <p className="font-display text-base font-bold">データを初期化する</p>
        <p className="mt-2 text-sm leading-relaxed">
          会話・保存済み条件・プランセット・ファクト・取得スナップショットを全て消して初期状態に戻します。施設辞書・エリア間移動時間・待ち時間参考サイトの初期データは残ります。
        </p>
        <p className="mt-2 text-sm text-[var(--dim)]">
          現在の件数：固定タブ {counts.fixedTabs}枚／プランセット {counts.planSetTabs}枚／会話 {counts.messages}件／施設辞書 {counts.facilities}件／エリア間移動時間 {counts.areaMoves}件／参考サイト {counts.waitSites}件
        </p>
        {resetDone ? (
          <p className="mt-3 rounded-[var(--radius)] bg-[var(--surface-alt)] px-3.5 py-2.5 text-sm font-semibold leading-relaxed">
            初期化しました。データはすべて消え、初期状態に戻っています。
          </p>
        ) : resetConfirming ? (
          <div className="mt-3 rounded-[var(--radius)] border-2 border-[var(--accent)] bg-[var(--surface)] px-3.5 py-3">
            <p className="text-sm font-bold leading-relaxed">
              本当に初期化しますか？保存されたデータはすべて消え、元に戻すことはできません。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={resetMutation.isPending}
                onClick={() => resetMutation.mutate()}
                className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-bold text-[var(--accent-text)] disabled:opacity-50"
              >
                {resetMutation.isPending ? "初期化しています…" : "本当に初期化する"}
              </button>
              <button
                type="button"
                disabled={resetMutation.isPending}
                onClick={() => setResetConfirming(false)}
                className="rounded-full bg-[var(--surface-alt)] px-4 py-1.5 text-sm font-bold disabled:opacity-50"
              >
                やめる
              </button>
            </div>
            {resetMutation.isError ? (
              <p className="mt-2 text-sm leading-relaxed text-[var(--accent)]">
                初期化できませんでした。少し待ってもう一度お試しください。
              </p>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setResetConfirming(true)}
            className="mt-3 rounded-full border border-[var(--accent)] px-4 py-1.5 text-sm font-bold text-[var(--accent)]"
          >
            データを初期化する
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- app shell

export function App() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>({ type: "chat" });
  const [draft, setDraft] = useState("");
  // Why an attempted send did not go out (an empty message), shown
  // above the composer instead of silently doing nothing.
  const [composerError, setComposerError] = useState<string | null>(null);
  // The text of the in-flight send, shown in the chat immediately so the
  // automatic switch to the chat tab is self-explanatory.
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  // The A/B/C slot selected in each plan-set tab, kept per set in the
  // shell so a message sent from the bottom form can report the plan
  // the user is looking at (the AI's reference for 「プランB」 etc.).
  // null = that set's 「条件」 panel is selected.
  const [planSlotBySet, setPlanSlotBySet] = useState<Record<number, SubTab | null>>(
    {},
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastSentRef = useRef("");

  const stateQuery = useQuery({
    queryKey: ["state"],
    queryFn: () => api.getState({}),
    refetchInterval: (q) => (q.state.data?.planSets.some((s) => s.status === "creating") ? 20000 : false),
  });

  const sendMutation = useMutation({
    mutationFn: async (payload: { text: string; openTab: { type: string; setId: number | null; slot: string | null } }) =>
      await api.sendChatMessage(payload),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: () => {
      // 送信に失敗したら下書きを復元する
      if (lastSentRef.current) setDraft(lastSentRef.current);
    },
    // Settle ALWAYS refetches the state, not only on success: the
    // server saves the user message before inference and the reply
    // when it is ready, so if the response itself is lost the saved
    // reply must still surface in the chat.
    onSettled: () => {
      setPendingText(null);
      queryClient.invalidateQueries();
    },
  });

  const state = stateQuery.data;
  const activePlanSet =
    tab.type === "set" ? state?.planSets.find((s) => s.id === tab.id) : undefined;
  const effectiveTab: Tab =
    tab.type === "set" && state && !activePlanSet ? { type: "chat" } : tab;

  // Desktop drag/wheel sideways scrolling for the tab strip.
  const tabBarRef = useDragScroll<HTMLDivElement>();

  const submitDraft = () => {
    const text = draft.trim();
    if (!text) {
      setComposerError("メッセージを入力してください。");
      return;
    }
    if (sendMutation.isPending) return;
    setComposerError(null);
    // Capture the tab open at send time BEFORE the view switches to
    // the chat tab: the AI resolves plan references against the plan
    // set open in that tab (and the A/B/C slot selected in it).
    const openTab = {
      type: effectiveTab.type,
      setId: effectiveTab.type === "set" ? effectiveTab.id : null,
      slot:
        effectiveTab.type === "set"
          ? (planSlotBySet[effectiveTab.id] ?? "A")
          : null,
    };
    lastSentRef.current = draft;
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setPendingText(text);
    sendMutation.mutate({ text, openTab });
    setTab({ type: "chat" });
  };

  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !composing && !(e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) {
      e.preventDefault();
      submitDraft();
    }
  };

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  return (
    <div className="flex h-dvh flex-col bg-[var(--bg)] text-[var(--text)]">
      {/* Tab bar: the four fixed tabs, then one tab per plan set.
          Pinned to the top of the screen (sticky) so it never
          scrolls away. */}
      <div
        ref={tabBarRef}
        role="tablist"
        aria-label="タブ"
        className="pt-safe sticky top-0 z-30 flex w-full min-w-0 shrink-0 cursor-grab gap-1.5 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2"
      >
        <TabButton
          label="チャット"
          active={effectiveTab.type === "chat"}
          onClick={() => setTab({ type: "chat" })}
        />
        <TabButton
          label="プラン作成"
          active={effectiveTab.type === "form"}
          onClick={() => setTab({ type: "form" })}
        />
        <TabButton
          label="待ち時間参考サイト"
          active={effectiveTab.type === "sites"}
          onClick={() => setTab({ type: "sites" })}
        />
        <TabButton
          label="もっとこうして！"
          active={effectiveTab.type === "more"}
          onClick={() => setTab({ type: "more" })}
        />
        {(state?.planSets ?? []).map((s) => (
          <TabButton
            key={s.id}
            label={`${formatDateLabel(s.condition.visitDate)} ${parkLabel(s.condition.park)}`}
            active={effectiveTab.type === "set" && effectiveTab.id === s.id}
            badge={
              s.status === "creating"
                ? "作成中"
                : s.status === "failed"
                  ? "失敗"
                  : undefined
            }
            onClick={() => setTab({ type: "set", id: s.id })}
          />
        ))}
      </div>

      {/* Content. Plan tabs drop the centered max-width at lg and up so
          their two-pane split spans the full display width; every other
          tab (and every tab below lg) keeps the centered column. */}
      <main
        className={`mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col ${
          effectiveTab.type === "set" && activePlanSet
            ? "lg:mx-0 lg:max-w-none"
            : ""
        }`}
      >
        {stateQuery.isPending ? (
          <p className="px-4 py-10 text-center text-sm text-[var(--dim)]">読み込んでいます…</p>
        ) : stateQuery.isError || !state ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm">読み込めませんでした。</p>
            <button
              type="button"
              onClick={() => stateQuery.refetch()}
              className="mt-3 rounded-full bg-[var(--surface-alt)] px-4 py-2 text-sm font-semibold"
            >
              もう一度試す
            </button>
          </div>
        ) : effectiveTab.type === "chat" ? (
          <ChatView
            messages={state.messages}
            sending={sendMutation.isPending}
            pendingText={pendingText}
            onGoForm={() => setTab({ type: "form" })}
          />
        ) : effectiveTab.type === "form" ? (
          <ConditionForm
            saved={state.savedCondition}
            onStarted={(setId) => setTab({ type: "set", id: setId })}
          />
        ) : effectiveTab.type === "sites" ? (
          <SitesView sites={state.waitSites} />
        ) : effectiveTab.type === "more" ? (
          <MoreView counts={state.counts} />
        ) : activePlanSet ? (
          <PlanSetView
            key={activePlanSet.id}
            setId={activePlanSet.id}
            startedAt={activePlanSet.startedAt}
            progress={activePlanSet.progress}
            onDeleted={() => setTab({ type: "chat" })}
            selectedSlot={
              activePlanSet.id in planSlotBySet
                ? (planSlotBySet[activePlanSet.id] ?? null)
                : "A"
            }
            onSelectSlot={(slot) =>
              setPlanSlotBySet((prev) => ({ ...prev, [activePlanSet.id]: slot }))
            }
          />
        ) : null}
        {sendMutation.isPending ? (
          <div
            role="status"
            className="shrink-0 border-t-2 border-[var(--accent)] bg-[var(--surface-alt)] px-4 py-3"
          >
            <p className="flex items-center justify-center gap-2.5 text-center">
              <span aria-hidden className="flex items-end gap-1">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </span>
              <span className="text-base font-bold">
                メッセージを送信しました。AIが返信を考えています…
              </span>
            </p>
            <p className="mt-1 text-center text-xs text-[var(--dim)]">
              返信ができたら、AIチャットに表示されます。
            </p>
          </div>
        ) : sendMutation.isError ? (
          <p
            role="alert"
            className="shrink-0 px-4 pb-2 text-center text-sm font-semibold text-red-700 dark:text-red-300"
          >
            送信できませんでした。もう一度お試しください。
          </p>
        ) : null}
      </main>

      {/* Fixed AI instruction form (TAB1 conversation), always at the bottom. */}
      <div className="sticky bottom-0 border-t border-[var(--border)] bg-[var(--surface)] pb-safe">
        {composerError ? (
          <p
            role="alert"
            className="mx-auto w-full max-w-3xl px-3 pt-2 text-sm font-semibold text-red-700 dark:text-red-300"
          >
            {composerError}
          </p>
        ) : null}
        <form
          className="mx-auto flex w-full max-w-3xl items-end gap-2 px-3 py-2.5"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            submitDraft();
          }}
        >
          <label htmlFor="ai-composer" className="sr-only">
            AIへの指示
          </label>
          <textarea
            {...FIELDS.sendChatMessage.text}
            id="ai-composer"
            ref={textareaRef}
            rows={1}
            value={draft}
            placeholder="AIに話しかける"
            className="max-h-[120px] flex-1 resize-none rounded-2xl border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2.5 text-base"
            onChange={(e) => {
              setDraft(e.target.value);
              setComposerError(null);
              autoGrow();
            }}
            onKeyDown={onComposerKeyDown}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
          />
          <button
            type="submit"
            disabled={!draft.trim() || sendMutation.isPending}
            aria-label="送信"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-lg font-bold text-[var(--accent-text)] disabled:opacity-40"
          >
            ↑
          </button>
        </form>
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  badge,
  onClick,
}: {
  label: string;
  active: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
        active
          ? "bg-[var(--text)] text-[var(--bg)]"
          : "bg-[var(--surface-alt)] text-[var(--text)]"
      }`}
    >
      {label}
      {badge ? (
        <span className="ml-1.5 rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-bold text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
