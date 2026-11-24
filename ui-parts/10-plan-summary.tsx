function CrowdFactorsRecord({
  factors,
}: {
  factors: { name: string; factor: number; slot: "A" | "B" | "C" | null }[];
}) {
  const slots = (["A", "B", "C"] as const)
    .map((slot) => ({
      slot,
      list: factors.filter((f) => f.slot === slot),
    }))
    .filter((g) => g.list.length > 0);
  const flat = factors.filter((f) => f.slot == null);
  return (
    <div className="mt-1.5">
      <p className="text-[var(--dim)]">
        施設ごとの実効係数（混雑予想にもとづき、待ち時間の基礎推定に掛けた係数）
      </p>
      {slots.map((g) => (
        <div key={g.slot} className="mt-1">
          <p className="text-[var(--dim)]">プラン{g.slot}</p>
          <ul className="mt-0.5 space-y-0.5 text-[var(--dim)]">
            {g.list.map((f, i) => (
              <li key={i}>
                {f.name}：{crowdFactorLabel(f.factor)}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {flat.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-[var(--dim)]">
          {flat.map((f, i) => (
            <li key={i}>
              {f.name}：{crowdFactorLabel(f.factor)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// "12時間" / "6時間30分" style label for the summary's 滞在時間.
function formatStayDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
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
// place in this app where the numbers are shown big. Every value
// comes from the server's read-time derivation (plan.summaryStats,
// the same values the PDF prints), so switching A/B/C switches the
// whole summary with the plan. Row order is the owner's design:
// 1) 費用概算／アトラクション／待ち時間合計 (the three that matter
// most), 2) 移動時間合計／歩行距離概算／滞在時間 (how tiring the day
// is), 3) ショー／パレード／レストラン (small), 4) an amber
// 未確認 band, ONLY when the plan actually has unconfirmed rows,
// followed by the under-5 child （ひざ上） explanation band in the
// same amber look, ONLY when the set's party includes a child
// under 5 (plan.lapChildNote, derived server-side at read time).
function PlanSummaryStats({ plan }: { plan: Plan }) {
  const s = plan.summaryStats;
  const yen = (n: number): string => `¥${n.toLocaleString("ja-JP")}`;
  return (
    <div className="mt-3">
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          label="費用概算"
          value={
            s.totalCostJpy != null ? (
              <>
                {s.totalCostJpy.toLocaleString("ja-JP")}
                <span className="ml-0.5 text-xs font-semibold">円</span>
              </>
            ) : (
              "―"
            )
          }
          sub={
            <>
              <p>
                うちDPA {yen(s.dpaAmountJpy)}・{s.dpaCount}件
              </p>
              {s.budgetJpy != null ? (
                <p>
                  予算 {yen(s.budgetJpy)}
                  {s.budgetDiffJpy != null
                    ? s.budgetDiffJpy >= 0
                      ? `（残り ${yen(s.budgetDiffJpy)}）`
                      : `（${(-s.budgetDiffJpy).toLocaleString("ja-JP")}円超過）`
                    : ""}
                </p>
              ) : null}
            </>
          }
        />
        <StatCard
          label="アトラクション"
          value={
            <>
              {s.attractionCount}
              <span className="ml-0.5 text-xs font-semibold">件</span>
            </>
          }
          sub={
            <>
              <p>うちDPA {s.attractionDpaCount}件</p>
              {s.attractionDpaRatePct != null ? (
                <p>DPA率 {s.attractionDpaRatePct}%</p>
              ) : null}
            </>
          }
        />
        <StatCard
          label="待ち時間合計"
          value={
            <>
              {s.totalWaitMin}
              <span className="ml-0.5 text-xs font-semibold">分</span>
            </>
          }
          sub={
            s.longestWait ? (
              <p>
                最長：{s.longestWait.name} {s.longestWait.waitMin}分
              </p>
            ) : null
          }
        />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <StatCard
          label="移動時間合計"
          value={
            s.totalTravelMin != null ? (
              <>
                {s.totalTravelMin}
                <span className="ml-0.5 text-xs font-semibold">分</span>
              </>
            ) : (
              "―"
            )
          }
        />
        <StatCard
          label="歩行距離概算"
          value={s.totalWalkM != null ? formatWalkDistance(s.totalWalkM) : "―"}
        />
        <StatCard
          label="滞在時間"
          value={s.stayMinutes != null ? formatStayDuration(s.stayMinutes) : "―"}
          sub={
            s.stayStartLabel && s.stayEndLabel ? (
              <p>
                {s.stayStartLabel}〜{s.stayEndLabel}
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
              {s.showCount}
              <span className="ml-0.5 text-[11px] font-semibold">件</span>
            </>
          }
        />
        <StatCard
          small
          label="パレード"
          value={
            <>
              {s.paradeCount}
              <span className="ml-0.5 text-[11px] font-semibold">件</span>
            </>
          }
        />
        <StatCard
          small
          label="レストラン"
          value={
            <>
              {s.restaurantCount}
              <span className="ml-0.5 text-[11px] font-semibold">件</span>
            </>
          }
          sub={<p>うちショーレストラン {s.showRestaurantCount}件</p>}
        />
      </div>
      {s.unconfirmed.length > 0 ? (
        <div className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-sm leading-relaxed text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <span className="font-semibold">
            未確認{s.unconfirmed.length}件：
          </span>
          {s.unconfirmed
            .map((u) => `${u.name}（${u.reason}）`)
            .join("、")}
        </div>
      ) : null}
      {plan.lapChildNote ? (
        <div className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-sm leading-relaxed text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <span className="font-semibold">
            {plan.lapChildNote.slice(
              0,
              plan.lapChildNote.indexOf("：") + 1,
            )}
          </span>
          {plan.lapChildNote.slice(plan.lapChildNote.indexOf("：") + 1)}
        </div>
      ) : null}
    </div>
  );
}

// Plan name + cost, shown first under the map: the total, then the
// itemized breakdown lines (チケット / DPA / 食事 / お土産 …) when the
// generation produced them. The prose description lives in the
// プランの説明 detail tab instead. Directly under the title (inside
// this header card) the plan's premise is shown: for sets made
// under the unified conditions model, the single 「重視する点」
// (shared by all three plans) plus THIS plan's crowd scenario
// premise; for older sets, the legacy per-slot priority plus the
// common priority. Both come from the set's stored conditions
// snapshot / plan row — what the user actually entered for THIS
// run, not the current form values. Compact lines only, so the
// schedule rows below are not crowded.
function PlanCostHeader({
  plan,
  priorities,
}: {
  plan: Plan;
  priorities?: PlanSet["priorities"] | null;
}) {
  const scenarioPremise = crowdScenarioPremiseText(plan);
  const unified = priorities?.model === "unified";
  const ownPriority = unified ? null : (priorities?.[plan.slot] ?? null);
  const commonPriority = unified ? null : (priorities?.common ?? null);
  const unifiedPriority = unified ? (priorities?.unified ?? null) : null;
  // Stored plan titles may already carry the 「プランX：」 prefix (the
  // generation sometimes includes it), so strip it before composing
  // the heading — the same treatment the PDF renderer applies —
  // otherwise the heading reads 「プランA：プランA：…」.
  const cleanTitle = plan.title.replace(/^プラン[ABC][:：]\s*/, "");
  return (
    <div className="mt-3 rounded-[var(--radius)] bg-[var(--surface-alt)] px-3.5 py-3">
      <p className="font-display text-base font-bold">
        <span
          aria-hidden
          className="mr-2 inline-block h-3 w-3 rounded-full align-baseline"
          style={{ background: PLAN_COLORS[plan.slot] }}
        />
        プラン{plan.slot}：{cleanTitle}
      </p>
      {/* The summary headline sits directly under the plan title,
          before the schedule and the cost breakdown. The former
          travel-totals line under the cost section was absorbed
          into it (移動時間合計／歩行距離概算 live there now) — it
          is not shown twice. */}
      <PlanSummaryStats plan={plan} />
      {plan.estimatedCostJpy != null ? (
        <div className="mt-2">
          <p className="text-sm font-semibold">
            概算費用（合計）: 約{plan.estimatedCostJpy.toLocaleString("ja-JP")}円
          </p>
          {plan.costBreakdown.length > 0 ? (
            <dl className="mt-1.5 space-y-1">
              {plan.costBreakdown.map((line, i) => (
                <div
                  key={i}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <dt className="text-[var(--dim)]">{line.label}</dt>
                  <dd className="text-right">
                    {line.amountJpy != null
                      ? `${line.amountJpy.toLocaleString("ja-JP")}円`
                      : ""}
                    {line.note ? (
                      <span className="text-[var(--dim)]">{line.note}</span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ) : null}
      {scenarioPremise || unifiedPriority || ownPriority || commonPriority ? (
        <div className="mt-3 border-t border-[var(--border)] pt-2.5">
          <p className="text-xs font-semibold text-[var(--dim)]">
            このプランの前提
          </p>
          {scenarioPremise ? (
            <p className="mt-1 text-sm font-semibold leading-relaxed">
              {scenarioPremise}
            </p>
          ) : null}
          {unifiedPriority ? (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
              <span className="font-semibold">重視する点：</span>
              {unifiedPriority}
            </p>
          ) : null}
          {ownPriority ? (
            <p className="mt-1 text-sm leading-relaxed">
              <span className="font-semibold">プラン{plan.slot}：</span>
              {ownPriority}
            </p>
          ) : null}
          {commonPriority ? (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
              <span className="font-semibold">共通：</span>
              {commonPriority}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

