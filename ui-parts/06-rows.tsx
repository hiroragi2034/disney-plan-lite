function dpaNameKey(name: string): string {
  return name.normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
}

// Application period of one extracted DPA entry, as read from the
// official sources at creation time; empty when no period
// could be read (the facility was judged as part of the lineup in
// force at fetch time).
function dpaPeriodSuffix(d: {
  effectiveFrom: string | null;
  effectiveTo: string | null;
}): string {
  const ja = (iso: string): string => {
    const [y = "", m = "", dd = ""] = iso.split("-");
    return `${Number(y)}年${Number(m)}月${Number(dd)}日`;
  };
  if (d.effectiveFrom && d.effectiveTo) {
    return `（${ja(d.effectiveFrom)}〜${ja(d.effectiveTo)}）`;
  }
  if (d.effectiveFrom) return `（${ja(d.effectiveFrom)}から）`;
  if (d.effectiveTo) return `（${ja(d.effectiveTo)}まで）`;
  return "";
}

// Row-level unconfirmed mark (§9.4): a row that places a value which
// could not be confirmed from official sources carries the mark
// 「未確定（理由）」 with its short reason, visually distinct from a
// confirmed row (dashed amber outline). Tapping the reason toggles
// the explanation the row itself stores (why it is unconfirmed,
// including the official publication timing when known). Rows
// without a reason render nothing. The tap must not trigger the
// row's own tap behaviour (map pan), so it stops propagation.
function UnconfirmedMark({ item }: { item: PlanItem }) {
  const [open, setOpen] = useState(false);
  if (!item.unconfirmedReason) return null;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`未確定（${item.unconfirmedReason}）。押すと説明を表示します`}
        onClick={(ev) => {
          ev.stopPropagation();
          setOpen((o) => !o);
        }}
        className="rounded-full border border-dashed border-amber-600 bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-100"
      >
        未確定（{item.unconfirmedReason}）
      </button>
      {open ? (
        <p className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-sm leading-relaxed text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {item.unconfirmedNote ??
            "公式情報ではまだ確定していない要素です。確定情報が出たら、プランの作り直しで反映できます。"}
        </p>
      ) : null}
    </div>
  );
}

// Restaurant classification display, derived at render time from
// the restaurant fact layer classification the server attached to
// the row (item.restaurantInfo) — grounded facts read from the
// facility's own official detail page; the row itself stores
// nothing, so plans saved before a fact existed show it too.
// - 予約必須 (show restaurants): a large warning block that cannot
//   be missed when the row is opened — the row sits in the plan on
//   the premise that a reservation has been secured.
// - Otherwise: the reservation / priority-seating / mobile-order
//   status as short chips.
// - 未確認 is stated explicitly, never left blank (a blank would
//   read as "nothing needed"); the row's official-page link is the
//   reader's way to check.
// Rows without an identified facility carry no restaurantInfo and
// render nothing here.
function RestaurantInfo({ item }: { item: PlanItem }) {
  const info = item.restaurantInfo;
  if (!info) return null;
  if (info.reservationType === "required") {
    return (
      <div className="mt-2 rounded-lg border-2 border-red-600 bg-red-100 px-3 py-2.5 dark:border-red-500 dark:bg-red-950">
        <p className="text-base font-bold leading-snug text-red-900 dark:text-red-100">
          予約必須のレストランです
        </p>
        <p className="mt-1 text-sm leading-relaxed text-red-900 dark:text-red-100">
          このお店は事前予約が必要です。この行は、予約が取れている前提で入っています。予約方法は下の公式ページで確認してください。
        </p>
      </div>
    );
  }
  const reservationLabel =
    info.reservationType === "ps"
      ? "PS対象（プライオリティ・シーティング）"
      : info.reservationType === "none"
        ? "予約なし"
        : "予約情報：未確認";
  const mobileLabel =
    info.mobileOrder === "available"
      ? "モバイルオーダー対象"
      : info.mobileOrder === "unavailable"
        ? "モバイルオーダー対象外"
        : "モバイルオーダー：未確認";
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="rounded-full bg-[var(--surface-alt)] px-2.5 py-1 font-semibold text-[var(--text)]">
        {reservationLabel}
      </span>
      <span className="rounded-full bg-[var(--surface-alt)] px-2.5 py-1 font-semibold text-[var(--text)]">
        {mobileLabel}
      </span>
    </p>
  );
}

function RowList({
  entries,
  rowRefs,
  showPinNumbers,
  onRowTap,
  dpaPrices,
  onCantBuy,
  onLotteryLost,
}: {
  entries: { item: PlanItem; color: string }[];
  rowRefs?: RefObject<(HTMLLIElement | null)[]>;
  showPinNumbers?: boolean;
  // Called with the entry index when a row is tapped; the parent centres
  // the map on that row's place (rows without coordinates ignore it).
  onRowTap?: (index: number) => void;
  // Official DPA unit prices by normalized facility name, from the plan
  // set's verification record (the normalized facts the DPA gate
  // judged by at creation time). A purchase event whose
  // facility is not in this map renders without a price — never a
  // guessed one.
  dpaPrices?: Map<string, number>;
  // When set (finished set, this plan not already being replaced), each
  // DPA purchase event row carries the 「買えなかったら？」 button,
  // called with that purchase's plan item.
  onCantBuy?: (item: PlanItem) => void;
  // When set (same condition as onCantBuy), each lottery item inside
  // the 「最初の10分」 block carries the 「抽選に外れたら？」 button,
  // called with the SHOW row the item names (the reschedule works on
  // the show's own row, exactly like the DPA flow works on its usage
  // row). A lottery item whose show is not in this plan renders
  // without the button.
  onLotteryLost?: (item: PlanItem) => void;
}) {
  // DPA purchase events, merged into the timeline AT their purchase
  // time. Buying a Premier Access pass is a decision point of the
  // day (one pass per purchase, the next at least 60 minutes later,
  // and a failed purchase forces a reschedule), so EVERY purchase —
  // not just the first one after entry — stands as its own event.
  // Each event is derived from its row's stored dpaPurchaseTime and
  // inserted before the first row that starts later than the
  // purchase (never after the pass's own row, which the purchase
  // must precede); an unparseable time falls back to just before
  // its own row.
  const toMin = (label: string | null): number | null => {
    if (!label) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(label);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  type PurchaseEvent = { item: PlanItem; ownIdx: number; time: number };
  const eventsAt = new Map<number, PurchaseEvent[]>();
  // A purchase instance (facility × purchase event) that a stored
  // purchase-event row (kind "purchase") already represents: the
  // usage row must not ALSO derive an event for it, or the same
  // purchase would stand in the timeline twice. The stored row
  // itself renders as the event (at its own position, with its
  // stored unit price).
  const instanceKey = (item: PlanItem): string =>
    `${dpaNameKey(item.name)}|${item.dpaPurchaseTime ?? item.timeLabel ?? ""}`;
  const storedPurchaseKeys = new Set(
    entries
      .filter(
        (e) =>
          e.item.kind === "purchase" &&
          e.item.passType != null &&
          /プレミアアクセス|DPA/i.test(e.item.passType),
      )
      .map((e) => instanceKey(e.item)),
  );
  entries.forEach((e, i) => {
    const isDpaE =
      e.item.passType != null && /プレミアアクセス|DPA/i.test(e.item.passType);
    if (!isDpaE) return;
    if (e.item.kind === "purchase") {
      const t = toMin(e.item.dpaPurchaseTime ?? e.item.timeLabel);
      const list = eventsAt.get(i) ?? [];
      list.push({ item: e.item, ownIdx: i, time: t ?? Number.MAX_SAFE_INTEGER });
      eventsAt.set(i, list);
      return;
    }
    if (!e.item.dpaPurchaseTime) return;
    if (storedPurchaseKeys.has(instanceKey(e.item))) return;
    const t = toMin(e.item.dpaPurchaseTime);
    let at = i;
    if (t != null) {
      for (let j = 0; j < entries.length; j++) {
        const it = toMin(entries[j]?.item.timeLabel ?? null);
        if (it != null && it > t) {
          at = Math.min(j, i);
          break;
        }
      }
    }
    const list = eventsAt.get(at) ?? [];
    list.push({ item: e.item, ownIdx: i, time: t ?? Number.MAX_SAFE_INTEGER });
    eventsAt.set(at, list);
  });
  for (const list of eventsAt.values()) {
    list.sort((a, b) => a.time - b.time || a.ownIdx - b.ownIdx);
  }
  // The 「買えなかったら？」 reschedule works on the pass's usage
  // row (its purchase time and use time drive the rebuild); a
  // stored purchase-event row resolves to its usage row when one
  // exists in this plan.
  const cantBuyTarget = (item: PlanItem): PlanItem => {
    if (item.kind !== "purchase") return item;
    const usage = entries.find(
      (e) => e.item.kind !== "purchase" && instanceKey(e.item) === instanceKey(item),
    );
    return usage?.item ?? item;
  };
  // Tight legs （無理ポイント）, judged at render time from the
  // stored leg data: approximate walking distance ≥ 300 m AND
  // schedule slack ≤ 5 min (see tightLegTargets in plan_metrics).
  // Display-only — the caution row is not a plan item: it is never
  // counted, never pinned, and never reaches the verification gate.
  const tightTargets = tightLegTargets(entries.map((e) => e.item));
  return (
    <ol className="mt-3 space-y-2">
      {entries.map((e, i) => {
        // DPA (ディズニー・プレミアアクセス) rows get a solid accent badge so
        // paid-pass stops read at a glance; other passes get a quiet chip.
        const isDpa =
          e.item.passType != null &&
          /プレミアアクセス|DPA/i.test(e.item.passType);
        // Travel time into this row, computed by the server from the
        // two facilities' coordinates and the walking speed (never
        // estimated by the generation AI). Shown as a divider above
        // the row it leads into; a 移動 (move) row carries it as a
        // chip instead, since the row itself IS the movement. Null
        // (unverified leg / first row / older plan sets) shows
        // nothing — no invented number is ever displayed.
        const showTravel =
          i > 0 &&
          e.item.travelMin != null &&
          e.item.kind !== "move" &&
          e.item.kind !== "purchase" &&
          e.item.kind !== "first10";
        // A stored purchase-event row renders ONLY as its purchase
        // event card (above) — never as a schedule stop of its own.
        const isPurchaseRow = e.item.kind === "purchase";
        // The 「最初の10分」 block (kind "first10") is display-only
        // content: a heading, the first tasks as a bullet list, and
        // the fixed guidance line. Its note carries the parts one
        // per line — bullets start with 「・」, the guidance is the
        // remaining line(s). A bullet of the form 「◯◯の抽選をする」
        // is a lottery row: when this plan contains that show, it
        // carries the 「抽選に外れたら？」 button (the day-of
        // reschedule entry, same pattern as 「買えなかったら？」).
        const isFirst10 = e.item.kind === "first10";
        const first10Lines = isFirst10
          ? (e.item.note ?? "")
              .split(/\n+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
        const first10Bullets = first10Lines
          .filter((l) => l.startsWith("・"))
          .map((l) => l.replace(/^・\s*/, ""));
        const first10Rest = first10Lines.filter(
          (l) => !l.startsWith("・"),
        );
        const lotteryShowFor = (text: string): PlanItem | null => {
          const m = /^(.+)の抽選をする$/.exec(text);
          if (!m || !m[1]) return null;
          const key = dpaNameKey(m[1]);
          const found = entries.find(
            (x) =>
              x.item.kind === "show" && dpaNameKey(x.item.name) === key,
          );
          return found?.item ?? null;
        };
        return (
        <Fragment key={e.item.id}>
        {(eventsAt.get(i) ?? []).map((pe) => {
          const price =
            pe.item.unitPriceJpy ??
            dpaPrices?.get(dpaNameKey(pe.item.name)) ??
            null;
          return (
          <li
            key={`purchase-${pe.item.id}`}
            className="flex gap-3 rounded-[var(--radius)] border-2 border-[var(--accent)] bg-[var(--surface)] px-3 py-2.5"
          >
            <div className="flex w-[52px] shrink-0 flex-col items-start">
              <span className="text-base font-bold leading-tight tabular-nums">
                {pe.item.dpaPurchaseTime ?? pe.item.timeLabel}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-snug">
                🛒 DPA購入：{pe.item.name}
                {price != null ? ` ${price.toLocaleString("ja-JP")}円` : ""}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
                購入は1回に1枚だけ。買えなかったら、その後の予定の組み直しが必要になる分岐点です。
              </p>
              <UnconfirmedMark item={pe.item} />
              {onCantBuy ? (
                <button
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onCantBuy(cantBuyTarget(pe.item));
                  }}
                  className="mt-2 rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-sm font-bold text-white"
                >
                  買えなかったら？
                </button>
              ) : null}
            </div>
          </li>
          );
        })}
        {tightTargets.has(i) ? (
          <li className="rounded-[var(--radius)] border border-amber-400 bg-amber-100 px-3 py-2 text-sm leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            <p>{TIGHT_LEG_CAUTION_TEXT}</p>
          </li>
        ) : null}
        {showTravel ? (
          <li aria-hidden className="flex justify-center py-0.5">
            <span className="rounded-full bg-[var(--surface-alt)] px-3 py-1 text-xs font-semibold text-[var(--dim)]">
              移動 約{e.item.travelMin}分
            </span>
          </li>
        ) : null}
        {isFirst10 ? (
        <li
          key={e.item.id}
          className="rounded-[var(--radius)] border-2 bg-[var(--surface)] px-3 py-2.5"
          style={{ borderColor: KIND_COLORS.first10 }}
        >
          <div className="flex gap-3">
            <div className="flex w-[52px] shrink-0 flex-col items-start">
              <span className="text-base font-bold leading-tight tabular-nums">
                {e.item.timeLabel ?? ""}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-display text-base font-bold leading-snug">
                {e.item.name}
              </p>
              {first10Bullets.length > 0 ? (
                <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
                  {first10Bullets.map((b, bi) => {
                    const show = lotteryShowFor(b);
                    return (
                      <li key={bi} className="text-sm leading-relaxed">
                        {b}
                        {show && onLotteryLost ? (
                          <span className="mt-1 block">
                            <button
                              onClick={(ev) => {
                                ev.stopPropagation();
                                onLotteryLost(show);
                              }}
                              className="rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-sm font-bold text-white"
                            >
                              抽選に外れたら？
                            </button>
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {first10Rest.map((line, liIdx) => (
                <p
                  key={liIdx}
                  className="mt-2 text-sm leading-relaxed text-[var(--dim)]"
                >
                  {line}
                </p>
              ))}
            </div>
          </div>
        </li>
        ) : !isPurchaseRow ? (
        <li
          key={e.item.id}
          ref={
            rowRefs
              ? (el) => {
                  rowRefs.current[i] = el;
                }
              : undefined
          }
          onClick={() => onRowTap?.(i)}
          className={`flex gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5${
            e.item.lat != null && e.item.lng != null ? " cursor-pointer" : ""
          }`}
        >
          {/* Transit-guide layout: the time leads the row, large and
              first. The route pin number sits before the title (below). */}
          <div className="flex w-[52px] shrink-0 flex-col items-start">
            <span className="text-base font-bold leading-tight tabular-nums">
              {e.item.timeLabel ?? ""}
            </span>
            <span
              aria-hidden
              className="mt-2 h-2.5 w-2.5 rounded-full"
              style={{ background: e.color }}
            />
          </div>
          {e.item.imageUrl ? (
            <div className="flex w-14 shrink-0 flex-col items-center self-start">
              {/* Square thumbnail, guaranteed by three independent
                  mechanisms: the h-14/w-14 utilities, an explicit
                  aspect-ratio, and the width/height attributes. The
                  stored photos are landscape originals (860×400), so
                  if the height utility alone ever loses the cascade
                  (e.g. to the preflight img{height:auto} on some
                  phone browsers) the image renders wide — the aspect
                  ratio keeps the box 1:1 regardless. */}
              <img
                src={e.item.imageUrl}
                alt={`${e.item.name}の写真`}
                loading="lazy"
                width={56}
                height={56}
                className="aspect-square h-14 w-14 rounded-lg object-cover"
              />
              {e.item.imageSource === "reference" ? (
                <span className="mt-0.5 text-[10px] leading-none text-[var(--dim)]">
                  参考画像
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="flex items-start gap-1.5 text-base font-semibold leading-snug">
              {showPinNumbers && e.item.lat != null && e.item.lng != null ? (
                <span
                  aria-hidden
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: e.color }}
                >
                  {entries.slice(0, i + 1).filter((x) => x.item.lat != null && x.item.lng != null).length}
                </span>
              ) : null}
              <span className="min-w-0">{e.item.name}</span>
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[var(--dim)]">
              <span
                className="rounded-full px-2 py-0.5 font-semibold text-white"
                style={{ background: KIND_COLORS[e.item.kind] }}
              >
                {KIND_LABELS[e.item.kind]}
              </span>
              {e.item.area ? <span>{e.item.area}</span> : null}
              {e.item.kind === "move" && e.item.travelMin != null ? (
                <span className="font-semibold text-[var(--text)]">
                  移動 約{e.item.travelMin}分
                </span>
              ) : null}
            </p>
            {e.item.passType ? (
              <p className="mt-1.5 flex flex-wrap items-center gap-2">
                {isDpa ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] py-1 pl-1.5 pr-2.5 text-xs font-bold text-white">
                    <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold leading-none text-[var(--accent)]">
                      DPA
                    </span>
                    {e.item.passType}
                  </span>
                ) : (
                  <span className="inline-block rounded-full bg-[var(--surface-alt)] px-2.5 py-1 text-xs font-semibold text-[var(--dim)]">
                    {e.item.passType}
                  </span>
                )}
                {isDpa && e.item.dpaPurchaseTime ? (
                  <span className="text-xs font-semibold text-[var(--dim)]">
                    購入 {e.item.dpaPurchaseTime}
                  </span>
                ) : null}
              </p>
            ) : null}
            <UnconfirmedMark item={e.item} />
            <RestaurantInfo item={e.item} />
            {e.item.note ? (
              <p className="mt-1 text-sm leading-relaxed">{e.item.note}</p>
            ) : null}
            {e.item.officialUrl ? (
              <p className="mt-1.5">
                <a
                  href={e.item.officialUrl}
                  target="_blank"
                  rel="noopener"
                  onClick={(ev) => ev.stopPropagation()}
                  aria-label={`${e.item.name}の公式ページを開く`}
                  className="text-sm font-semibold text-[var(--accent)] underline underline-offset-2"
                >
                  公式ページ
                </a>
              </p>
            ) : null}
          </div>
          {/* The estimated wait is the single most important number on
              the row: it sits at the right end, large, as row data —
              never buried in the note text. Shown for 0 minutes too. */}
          {e.item.kind !== "restaurant" && e.item.estWaitMin != null ? (
            <div className="flex w-[68px] shrink-0 flex-col items-end justify-start pt-0.5 text-right">
              <span className="text-[11px] font-semibold leading-none text-[var(--dim)]">
                推定待ち
              </span>
              <span
                className={`mt-1 text-3xl font-bold leading-none tabular-nums${
                  e.item.estWaitMin >= 60 ? " text-[var(--accent)]" : ""
                }`}
              >
                {e.item.estWaitMin}
                <span className="text-base font-bold">分</span>
              </span>
            </div>
          ) : null}
        </li>
        ) : null}
        </Fragment>
        );
      })}
    </ol>
  );
}

// Split the generation notes into readable bullet points. Notes from newer
// generations are already one point per line; older ones are a single wall
// of text, so long lines fall back to splitting on sentence-ending 。.
function splitNotes(notes: string): string[] {
  const lines = notes
    .split(/\n+/)
    .map((s) => s.trim().replace(/^[・\-•*]\s*/, ""))
    .filter(Boolean);
  const points: string[] = [];
  for (const line of lines) {
    if (line.length <= 60) {
      points.push(line);
      continue;
    }
    const sentences = line
      .split("。")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `${s}。`);
    points.push(...(sentences.length > 0 ? sentences : [line]));
  }
  return points;
}

function NotesList({
  notes,
  restaurantWaitNote,
}: {
  notes: string;
  // The premise note for a plan containing restaurant rows (that
  // restaurant waits are not modelled), carried as text in the
  // getState payload — derived server-side at read time from the
  // plan's rows, like the restaurant classification display —
  // never written into the stored notes. Null when the displayed
  // plan has no restaurant rows.
  restaurantWaitNote?: string | null;
}) {
  const points = splitNotes(notes);
  if (restaurantWaitNote) {
    points.push(restaurantWaitNote);
  }
  if (points.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-sm font-semibold">このプランの前提・注意点</p>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
        {points.map((pt, i) => (
          <li key={i}>{pt}</li>
        ))}
      </ul>
    </div>
  );
}

