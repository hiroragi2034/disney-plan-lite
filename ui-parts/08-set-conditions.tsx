// ------------------------------------------------------- set conditions

// Short crowd-scenario words for the A/B/C switcher pills, in the
// owner's own shorthand （条件 A劇混み B混雑 C楽）: the scenario each
// plan was built under, readable at a glance in the strip itself.
const SCENARIO_SHORT_LABELS: Record<string, string> = {
  severe: "劇混み",
  expected: "混雑",
  light: "楽",
};
// The deterministic slot→scenario mapping of a standard set (server
// derives it from the slot and the set's forecast at save time).
const SLOT_SCENARIOS: Record<SubTab, string> = {
  A: "severe",
  B: "expected",
  C: "light",
};

const WALKING_SPEED_DISPLAY: Record<Conditions["walkingSpeed"], string> = {
  slow: "ゆっくり",
  slightly_slow: "少しゆっくり",
  slightly_fast: "少し急いで",
  fast: "急いで",
};

function formatVisitDateLabel(v: string | null): string {
  if (!v) return "未定";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return v;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

// The value handed to an <input type="time">: the control accepts
// ONLY the zero-padded "HH:MM" form — an unpadded "9:00" (the
// app's text convention, which older stored conditions and
// snapshot round-trips can still carry) is invalid there and the
// field renders blank even though a value exists. The server
// normalizes conditions to the padded form at its boundaries;
// this is the client-side guard so no path can blank the field
// again. Anything that is not an H:MM time passes through as-is.
function toTimeInputValue(v: string | null | undefined): string {
  if (!v) return "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return v;
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2]}`;
}

// Bounded time-of-day select. A native <input type="time"> offers
// all 24 hours, so nonsense like a 0:00 park entry was selectable.
// The parks' day runs roughly 9:00–22:00, so the forms offer only
// a plausible window in 15-minute steps (callers pass the window).
// A stored value outside the offered window is kept as its own
// option, so an existing value never renders blank or is silently
// replaced — it stays visible and can be changed away from.
function TimeSelect({
  id,
  value,
  onChange,
  className,
  startMin,
  endMin,
  extraOptions = [],
}: {
  id: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  className: string;
  // Minutes from midnight for the first / last offered time.
  startMin: number;
  endMin: number;
  // Additional offered times outside the stepped window.
  extraOptions?: string[];
}) {
  const v = toTimeInputValue(value);
  const stepped: string[] = [];
  for (let m = startMin; m <= endMin; m += 15) {
    stepped.push(
      `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`,
    );
  }
  const merged = [...extraOptions, ...stepped];
  const options =
    v && !merged.includes(v) ? [...merged, v].sort() : merged;
  return (
    <select
      id={id}
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
// generated under, parsed server-side from the set's own stored
// conditions snapshot — never the live プラン作成 form, which may
// have been edited since. The conditions are shared by A/B/C, so
// the panel belongs to the set, not to a plan. A field the snapshot
// could not give back (conditionsMissing) renders as 読み取れません
// でした rather than the parser's neutral fallback value. At the
// panel's bottom sits 「条件を変えて再検索」: it hands these very
// conditions back to the プラン作成 tab (the standard form, or the
// 当日検索 section for a same-day set) so they can be tweaked and
// searched again — the panel is a view of the set's conditions,
// the button is the way back into the form with them.
function SetConditionsPanel({
  planSet,
  onResearch,
  researching,
  researchError,
}: {
  planSet: PlanSet;
  onResearch: () => void;
  researching: boolean;
  researchError: string | null;
}) {
  const c = planSet.conditions;
  const missing = new Set(planSet.conditionsMissing);
  const unreadable = (label: string): ReactNode =>
    missing.has(label) ? (
      <span className="text-[var(--dim)]">読み取れませんでした</span>
    ) : null;
  return (
    <div className="mx-4 mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3">
      <p className="text-sm font-bold">このプランの検索条件</p>
      {c == null ? (
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">
          このプランには検索条件が保存されていません。
        </p>
      ) : (
        <dl className="mt-1 text-sm leading-relaxed">
          <CondRow label="パーク">
            {unreadable("パーク") ??
              (c.park === "land"
                ? "東京ディズニーランド"
                : "東京ディズニーシー")}
          </CondRow>
          <CondRow label="日付">
            {unreadable("日付") ?? formatVisitDateLabel(c.visitDate)}
          </CondRow>
          {planSet.setType === "same_day" && planSet.sameDay ? (
            <>
              <CondRow label="現在地">{planSet.sameDay.location}</CondRow>
              <CondRow label="開始時刻">
                {planSet.sameDay.startTime}から閉園まで
              </CondRow>
              <CondRow label="人数">
                {unreadable("人数") ??
                  `大人${c.adults}人・子ども${c.children}人`}
              </CondRow>
              <CondRow label="予算（上限）">
                {unreadable("予算") ??
                  (c.budgetJpy != null
                    ? `${c.budgetJpy.toLocaleString("ja-JP")}円`
                    : "未定")}
              </CondRow>
              <CondRow label="ご要望">
                <span className="whitespace-pre-line">
                  {c.priority ?? "（入力なし）"}
                </span>
              </CondRow>
            </>
          ) : (
            <>
              <CondRow label="入園〜退園">
                {unreadable("入園〜退園時刻") ??
                  `${c.entryTime ?? "未定"} 〜 ${c.exitTime ?? "未定"}`}
              </CondRow>
              <CondRow label="予算">
                {unreadable("予算") ??
                  (c.budgetJpy != null
                    ? `${c.budgetJpy.toLocaleString("ja-JP")}円`
                    : "未定")}
              </CondRow>
              <CondRow label="人数">
                {unreadable("人数") ??
                  `大人${c.adults}人・子ども${c.children}人${
                    c.childrenAges ? `（${c.childrenAges}）` : ""
                  }`}
              </CondRow>
              <CondRow label="重視する点">
                {unreadable("重視する点") ?? (
                  <span className="whitespace-pre-line">
                    {c.priority ?? "未入力"}
                  </span>
                )}
              </CondRow>
            </>
          )}
          <CondRow label="歩く速さ">
            {unreadable("歩く速さ") ?? WALKING_SPEED_DISPLAY[c.walkingSpeed]}
          </CondRow>
        </dl>
      )}
      {c != null ? (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <button
            type="button"
            disabled={researching}
            onClick={onResearch}
            className="w-full rounded-full bg-[var(--accent)] px-5 py-2.5 font-display text-base font-bold text-[var(--accent-text)] disabled:opacity-50"
          >
            {researching ? "移動しています…" : "条件を変えて再検索"}
          </button>
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--dim)]">
            {planSet.setType === "same_day"
              ? "この条件をプラン作成タブの「当日検索」に入力して移動します。条件を変えて、もう一度検索できます。"
              : "この条件をプラン作成タブのフォームに入力して移動します。条件を変えてから「この条件で3プランを作成」を押すと、新しいプランが作られます。"}
          </p>
          {researchError ? (
            <p
              role="alert"
              className="mt-1.5 text-sm font-semibold text-red-700 dark:text-red-300"
            >
              {researchError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- plan tab

