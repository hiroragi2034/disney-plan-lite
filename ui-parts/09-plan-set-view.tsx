function PlanSetView({
  planSet,
  rebuiltFromTitle,
  selectedSlot,
  onSelectSlot,
  onResearch,
}: {
  planSet: PlanSet;
  // Title of the original set this one was rebuilt from; null for a
  // first-time plan. A rebuild never overwrites its original, so the
  // plan view states that relationship instead of letting the new tab
  // look like the old one silently replaced (or unchanged).
  rebuiltFromTitle?: string | null;
  // The selected A/B/C slot lives in the App shell (per plan set), so
  // a message sent from the bottom form can report which plan the
  // user is looking at in this tab.
  selectedSlot: SubTab;
  onSelectSlot: (slot: SubTab) => void;
  // 「条件を変えて再検索」 (bottom of the 条件 panel): the App shell
  // switches to the プラン作成 tab. For a standard set the set's
  // conditions have already been written into the saved form by the
  // mutation below (prefill is null); for a same-day set the inputs
  // travel as a prefill for the form's 当日検索 section instead.
  onResearch: (prefill: SameDayPrefill | null) => void;
}) {
  const sub = selectedSlot;
  const [detailTab, setDetailTab] = useState<"schedule" | "about" | "crowd">(
    "schedule",
  );
  // A set without a crowd forecast has no 混雑予想 detail tab; if
  // that tab was left selected (e.g. after switching sets), fall
  // back to the schedule so the detail region never renders blank.
  const activeDetailTab =
    detailTab === "crowd" && planSet.crowdLevel == null
      ? "schedule"
      : detailTab;
  // The strip is ONE exclusive tab group — 条件 / A / B / C: exactly
  // one is selected at a time. Selecting 条件 shows this set's own
  // search conditions INSTEAD of everything below the strip (the
  // fixed map and the scrolling detail region are not rendered at
  // all, so the map's fixed height cannot break the layout);
  // selecting a plan switches back to the map + detail arrangement.
  const [showConditions, setShowConditions] = useState(false);
  // 地図表示 off, as reported by PlanMap's toggle: the map cell below
  // collapses to just the toggle button's height so the detail region
  // takes over the freed space.
  const [mapOff, setMapOff] = useState(false);
  const handleMapVisibilityChange = useCallback((visible: boolean) => {
    setMapOff(!visible);
  }, []);
  const queryClient = useQueryClient();
  const imageMutation = useMutation({
    mutationFn: () => api.requestItemImages({ planSetId: planSet.id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["state"] }),
  });
  // 「条件を変えて再検索」: a standard set's conditions are written
  // into the saved conditions form (saveConditions) so the プラン
  // 作成 tab opens with exactly them entered; the navigation itself
  // happens in the App shell via onResearch once the save lands. A
  // same-day set's inputs （現在地点・指定時刻・ご要望） have no place
  // in the standard form, so they travel as a prefill for the 当日
  // 検索 section instead and the saved form is left untouched.
  const researchMutation = useMutation({
    mutationFn: (c: Conditions) => api.saveConditions(c),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      onResearch(null);
    },
  });
  const researchError = researchMutation.isError
    ? "条件をプラン作成タブへ移せませんでした。少し待ってもう一度お試しください。"
    : null;
  const handleResearch = () => {
    const c = planSet.conditions;
    if (!c) return;
    if (planSet.setType === "same_day" && planSet.sameDay) {
      onResearch({
        park: c.park,
        location: planSet.sameDay.location,
        startTime: planSet.sameDay.startTime,
        adults: c.adults,
        children: c.children,
        childrenAges: c.childrenAges ?? "",
        budgetJpy: c.budgetJpy,
        walkingSpeed: c.walkingSpeed,
        request: planSet.sameDay.request ?? "",
      });
    } else {
      researchMutation.mutate(c);
    }
  };
  // Timeline row elements in the scrolling detail region, shared with the
  // fixed map so pin selection can highlight/scroll to the matching row.
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  // Desktop drag/wheel sideways scrolling for the A/B/C sub-tab strip
  // (same treatment as the main tab bar). The PDF button is a sibling
  // OUTSIDE this strip, so it stays pinned at the right end.
  const subTabBarRef = useDragScroll<HTMLDivElement>();
  // Handle to the mounted map so a schedule-row tap can highlight its
  // pin and smoothly pan the live map to it.
  const mapControllerRef = useRef<MapController | null>(null);
  // PDF export state: the PDF button sits at the right end of
  // the A/B/C sub-tab strip, while its working/error state renders in
  // the banner row under the strip — one hook holds both halves.
  const pdf = usePlanPdf(planSet);
  // 「買えなかったら？」 (a DPA purchase event could not be bought):
  // the tapped purchase event's item, the user's free-text situation
  // report, and the start mutation. Nothing starts from the button
  // itself — the dialog always confirms first, and the reschedule
  // starts only from the dialog's 「作り直す」.
  const [cantBuyItem, setCantBuyItem] = useState<PlanItem | null>(null);
  const [cantBuyNote, setCantBuyNote] = useState("");
  const cantBuyMutation = useMutation({
    mutationFn: async (args: { slot: SubTab; item: PlanItem; note: string }) =>
      await api.requestDpaReschedule({
        planSetId: planSet.id,
        slot: args.slot,
        itemId: args.item.id,
        userNote: args.note,
      }),
    onSuccess: (res) => {
      if (res.ok) {
        setCantBuyItem(null);
        setCantBuyNote("");
      }
      queryClient.invalidateQueries({ queryKey: ["state"] });
    },
  });
  const cantBuyError =
    cantBuyMutation.data && !cantBuyMutation.data.ok
      ? cantBuyMutation.data.error
      : cantBuyMutation.isError
        ? "リスケジュールを開始できませんでした。少し待ってもう一度お試しください。"
        : null;
  // 「抽選に外れたら？」 (a show's entry lottery was lost): the same
  // day-of report pattern as 「買えなかったら？」 — the show row the
  // tapped lottery item names, the user's free-text situation
  // report, and the start mutation. Nothing starts from the button
  // itself — the dialog always confirms first, and the reschedule
  // starts only from the dialog's 「作り直す」.
  const [lotteryItem, setLotteryItem] = useState<PlanItem | null>(null);
  const [lotteryNote, setLotteryNote] = useState("");
  const lotteryMutation = useMutation({
    mutationFn: async (args: { slot: SubTab; item: PlanItem; note: string }) =>
      await api.requestLotteryReschedule({
        planSetId: planSet.id,
        slot: args.slot,
        itemId: args.item.id,
        userNote: args.note,
      }),
    onSuccess: (res) => {
      if (res.ok) {
        setLotteryItem(null);
        setLotteryNote("");
      }
      queryClient.invalidateQueries({ queryKey: ["state"] });
    },
  });
  const lotteryError =
    lotteryMutation.data && !lotteryMutation.data.ok
      ? lotteryMutation.data.error
      : lotteryMutation.isError
        ? "リスケジュールを開始できませんでした。少し待ってもう一度お試しください。"
        : null;
  // 「他のAIで2重検証」: the button at the end of the displayed plan
  // fetches that plan's verification package from the server (saved
  // data only) and opens a dialog holding the full text. Copying
  // uses the standard Clipboard API; the package text is ALWAYS
  // also shown in a read-only, selectable textarea in the dialog,
  // so when the clipboard write fails in a WebView the user can
  // still copy it by hand. No verification runs in this app — the
  // pasted-into AI does the checking.
  const [verifyText, setVerifyText] = useState<string | null>(null);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const verifyMutation = useMutation({
    mutationFn: async (slot: SubTab) =>
      await api.getVerificationPackage({ planSetId: planSet.id, slot }),
    onSuccess: (res) => {
      setVerifyText(res.text);
      setCopyState("idle");
      setVerifyDialogOpen(true);
    },
  });
  const verifyError = verifyMutation.isError
    ? "検証用データを取得できませんでした。少し待ってもう一度お試しください。"
    : null;
  const handleCopyPackage = async () => {
    if (!verifyText) return;
    try {
      if (
        typeof navigator === "undefined" ||
        typeof navigator.clipboard?.writeText !== "function"
      ) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(verifyText);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };
  // Official DPA unit prices for the purchase-event rows, keyed by
  // normalized facility name, from this set's verification record
  // (the list the server extracted mechanically from the official
  // Premier Access page at creation time).
  const dpaPrices = new Map<string, number>(
    (planSet.verification?.dpaExtracted ?? []).map((d) => [
      dpaNameKey(d.name),
      d.priceJpy,
    ]),
  );

  // Plans already saved stay viewable even while the set as a whole is
  // still generating (or failed partway): only a set with NO saved plan
  // yet gets the full-screen progress / failure view below.
  const hasSavedPlans = planSet.plans.length > 0;

  if (planSet.status === "generating" && !hasSavedPlans) {
    return (
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-10 text-center">
        <p className="font-display text-lg font-bold">
          {planSet.setType === "same_day"
            ? "当日検索のプランを作成中です…"
            : planSet.rebuiltFromSetId != null
              ? "作り直し版を作成中です…"
              : "プランを作成中です…"}
        </p>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--dim)]">
          {planSet.setType === "same_day"
            ? `公式サイトで本日の営業時間・休止情報・ショーの時刻を確認し、現在の掲示待ち時間をもとに、${planSet.sameDay ? `「${planSet.sameDay.location}」を${planSet.sameDay.startTime}に出発して` : ""}閉園までのプランを1つ作っています。作成には10〜20分ほどかかることがあります。このタブを開いたままでも、他のタブに移っても大丈夫です。`
            : "公式サイトで対象日の営業時間・休止情報・ショーの時刻と、現在のパス制度を確認してから、混雑シナリオの違う3プランを1つずつ作っています。作成には10〜20分ほどかかることがあります。このタブを開いたままでも、他のタブに移っても大丈夫です。"}
        </p>
        <PlanProgressList planSet={planSet} />
        {planSet.rebuiltFromSetId != null ? (
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--dim)]">
            既存のプランをもとに新しいプランを作っています。元のプランはそのまま残ります。
          </p>
        ) : null}
        <GenerationEscapeBlock
          planSetId={planSet.id}
          startedAt={planSet.generationStartedAt}
          centered
          reportLines={planSet.reportLines.filter((l) => l.slot === null)}
        />
      </div>
    );
  }

  if (planSet.status === "failed" && !hasSavedPlans) {
    return (
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-10">
        <p className="font-display text-lg font-bold">
          {planSet.setType === "same_day"
            ? "当日検索のプランを作れませんでした"
            : planSet.rebuiltFromSetId != null
              ? "作り直しはできませんでした"
              : "プランを作れませんでした"}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-[var(--dim)]">
          {planSet.error ?? "公式情報を取得できませんでした。"}
        </p>
        {planSet.rebuiltFromSetId != null ? (
          <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
            元のプランはそのまま残っています。
          </p>
        ) : null}
        <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
          {planSet.setType === "same_day"
            ? "現在地点や指定時刻を変えて、プラン作成タブの「当日検索」からもう一度お試しください。"
            : "条件を変えて、プラン作成タブの「この条件で3プランを作成」からもう一度お試しください。"}
        </p>
        <FailedSetRetryBlock planSetId={planSet.id} />
      </div>
    );
  }

  const visiblePlans = planSet.plans.filter((p) => p.slot === sub);
  const entries = visiblePlans.flatMap((p) =>
    p.items.map((item) => ({ item, color: PLAN_COLORS[p.slot] })),
  );

  // Tapping a schedule row moves the map to that row's place: the pin
  // is highlighted via the handle, and the LIVE map pans to the place
  // with an animated easeTo that changes only the centre — the current
  // zoom is kept exactly as the user left it, and the map is not
  // remounted. Rows without coordinates have no pin to centre on.
  const handleRowTap = (entryIdx: number) => {
    const entry = entries[entryIdx];
    if (!entry || entry.item.lat == null || entry.item.lng == null) {
      return;
    }
    const pinnedIdx = entries
      .slice(0, entryIdx + 1)
      .filter((x) => x.item.lat != null && x.item.lng != null).length - 1;
    try {
      mapControllerRef.current?.selectPlace?.(pinnedIdx);
    } catch {
      /* selection is best-effort */
    }
    const target = { lat: entry.item.lat, lng: entry.item.lng };
    let panned = false;
    try {
      panned = mapControllerRef.current?.panTo?.(target) ?? false;
    } catch {
      panned = false;
    }
    if (!panned) {
      // The map may still be initialising (its camera is not ready);
      // retry the same pan once shortly after.
      window.setTimeout(() => {
        try {
          mapControllerRef.current?.panTo?.(target);
        } catch {
          /* pan is best-effort */
        }
      }, 350);
    }
  };

  // Intro photos belong to facilities, and one fetch covers the whole set
  // (all three plans share facilities), so this looks at every plan.
  const isFacilityItem = (it: PlanItem) =>
    it.kind === "attraction" ||
    it.kind === "show" ||
    it.kind === "parade" ||
    it.kind === "restaurant";
  const missingImages = planSet.plans.some((p) =>
    p.items.some((it) => !it.imageUrl && isFacilityItem(it)),
  );
  // The same fetch task also confirms each facility's official
  // detail-page link, so the fetch control covers missing links too
  // (plan sets generated before links existed backfill this way).
  const missingLinks = planSet.plans.some((p) =>
    p.items.some((it) => !it.officialUrl && isFacilityItem(it)),
  );
  const needsFetch = missingImages || missingLinks;
  const imageError =
    imageMutation.data && !imageMutation.data.ok
      ? imageMutation.data.error
      : imageMutation.isError
        ? "紹介画像の取得を開始できませんでした。少し待ってもう一度お試しください。"
        : null;

  return (
    <div
      className={`grid min-h-0 min-w-0 flex-1 grid-cols-1 ${
        showConditions
          ? "grid-rows-[auto_minmax(0,1fr)]"
          : "grid-rows-[auto_minmax(0,auto)_auto_minmax(0,1fr)] lg:grid-cols-2 lg:grid-rows-[auto_minmax(0,auto)_minmax(0,1fr)]"
      }`}
    >
      {/* Fixed top region: the sub-tab switcher stays put, with the map
          fixed below it; everything else lives in the detail region
          further down, which is the only part that scrolls. At desktop
          widths (lg and up) the same four regions become a two-pane
          split instead: switcher, banners and detail stack in the left
          column, and the map fills the right column at full height so
          it stays visible while the detail region scrolls. While
          「条件」 is selected the grid collapses to the switcher plus
          one scrolling row holding the conditions panel alone — the
          map and the detail region are not rendered, so the map's
          fixed height cannot break this layout. */}
      <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 px-4 pt-3">
      <div
        ref={subTabBarRef}
        role="tablist"
        aria-label="プラン切替"
        className="flex min-w-0 flex-1 cursor-grab gap-1.5 overflow-x-auto pb-1"
      >
        {/* The strip's left end is the set's own search conditions
            （条件 A劇混み B混雑 C楽 … PDF): the conditions belong to
            the whole set, not to one plan, and the strip is ONE
            exclusive tab group — selecting 「条件」 replaces the
            map and everything below it with the conditions view,
            and selecting a plan switches back. */}
        <button
          type="button"
          role="tab"
          aria-selected={showConditions}
          aria-label="このプランの検索条件を表示"
          onClick={() => setShowConditions(true)}
          className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold ${
            showConditions
              ? "bg-[var(--text)] text-[var(--bg)]"
              : "bg-[var(--surface-alt)] text-[var(--text)]"
          }`}
        >
          条件
        </button>
        {/* A 当日検索 set holds exactly one plan: only the プランA
            switcher shows, next to a 当日検索 chip that says what
            this tab is. */}
        {(planSet.setType === "same_day"
          ? (["A"] as SubTab[])
          : (["A", "B", "C"] as SubTab[])
        ).map((s) => {
          // The pill names the plan by its crowd scenario in the
          // owner's shorthand （A 劇混み / B 混雑 / C 楽） whenever the
          // scenario is known — from the saved plan itself, or, while
          // plans are still being generated, from the set's forecast
          // via the deterministic slot mapping. Sets with no scenario
          // (older sets) keep the plain プランA/B/C names.
          const savedPlan = planSet.plans.find((p) => p.slot === s);
          const scenario =
            savedPlan?.crowdScenario ??
            (planSet.setType === "standard" && planSet.crowdLevel != null
              ? SLOT_SCENARIOS[s]
              : null);
          const short =
            scenario != null ? SCENARIO_SHORT_LABELS[scenario] : undefined;
          return (
          <button
            key={s}
            role="tab"
            aria-selected={!showConditions && sub === s}
            onClick={() => {
              setShowConditions(false);
              onSelectSlot(s);
            }}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold ${
              !showConditions && sub === s
                ? "bg-[var(--text)] text-[var(--bg)]"
                : "bg-[var(--surface-alt)] text-[var(--text)]"
            }`}
          >
            {short ? `${s} ${short}` : `プラン${s}`}
            {planSet.planProgress[s] !== "done" ? (
              <span className="ml-1.5 text-xs font-semibold opacity-80">
                {PROGRESS_LABELS[planSet.planProgress[s]]}
              </span>
            ) : null}
          </button>
          );
        })}
        {planSet.setType === "same_day" ? (
          <span className="flex shrink-0 items-center rounded-full bg-[var(--accent)] px-3 py-1.5 text-sm font-bold text-[var(--accent-text)]">
            当日検索
          </span>
        ) : null}
      </div>

      {/* The PDF button lives at the right end of this strip, beside
          the A/B/C tabs it belongs to — always on screen, no hunting
          through the detail tabs. Finished sets only. */}
      {planSet.status === "done" ? <PdfButtons pdf={pdf} /> : null}
      </div>

      {/* Second grid row. In plan view it carries the status banners
          (generating / failed), collapsing to zero height when none
          shows. In 条件 view this row is the whole content area: it
          scrolls, and holds the set's search-conditions panel (plus
          the PDF block, whose button stays in the strip) — the map
          and the detail region below are not rendered at all. */}
      <div
        className={`col-start-1 row-start-2 min-h-0 min-w-0 ${
          showConditions
            ? "overflow-x-hidden overflow-y-auto pb-6"
            : "overflow-x-hidden overflow-y-auto"
        }`}
      >
      {showConditions ? (
        <>
          <SetConditionsPanel
            planSet={planSet}
            onResearch={handleResearch}
            researching={researchMutation.isPending}
            researchError={researchError}
          />
          {planSet.status === "done" ? <PdfExtras pdf={pdf} /> : null}
        </>
      ) : (
        <>
      {planSet.status === "generating" ? (
        <div className="mx-4 mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
          <p className="text-sm font-semibold">
            {planSet.setType === "same_day"
              ? "当日検索のプランを作成中です（作成には10〜20分ほどかかることがあります）"
              : "残りのプランを作成中です（作成には10〜20分ほどかかることがあります）"}
          </p>
          {planSet.setType !== "same_day" ? (
            <p className="mt-1 text-sm text-[var(--dim)]">
              {(["A", "B", "C"] as const)
                .map((s) => `プラン${s}：${PROGRESS_LABELS[planSet.planProgress[s]]}`)
                .join("／")}
            </p>
          ) : null}
          <GenerationEscapeBlock
            planSetId={planSet.id}
            startedAt={planSet.generationStartedAt}
            reportLines={planSet.reportLines.filter((l) => l.slot === null)}
          />
        </div>
      ) : null}
      {planSet.status === "failed" ? (
        <div
          role="alert"
          className="mx-4 mt-3 shrink-0 rounded-[var(--radius)] bg-red-100 px-3.5 py-2.5 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
        >
          作成は完了しませんでした{planSet.error ? `（${planSet.error}）` : ""}。保存できたプランだけを表示しています。
          <FailedSetRetryBlock planSetId={planSet.id} />
        </div>
      ) : null}
      {planSet.status === "done" &&
      (["A", "B", "C"] as const).some((s) => planSet.partialOpFailures[s]) ? (
        <div
          role="alert"
          className="mx-4 mt-3 shrink-0 rounded-[var(--radius)] bg-red-100 px-3.5 py-2.5 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
        >
          {(["A", "B", "C"] as const)
            .filter((s) => planSet.partialOpFailures[s])
            .map((s) => (
              <p key={s}>
                プラン{s}の差し替えはできませんでした。{planSet.partialOpFailures[s]}
                元のプラン{s}はそのまま残っています。
              </p>
            ))}
          <PartialOpFailedBlock planSetId={planSet.id} />
        </div>
      ) : null}
      {planSet.status === "done" &&
      (["A", "B", "C"] as const).some(
        (s) => planSet.planProgress[s] === "generating",
      ) ? (
        <div className="mx-4 mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
          <p className="text-sm font-semibold">
            {(["A", "B", "C"] as const)
              .filter((s) => planSet.planProgress[s] === "generating")
              .map((s) => `プラン${s}`)
              .join("・")}
            を差し替え中です
          </p>
          <p className="mt-1 text-sm text-[var(--dim)]">
            表示されている内容は差し替え前のものです。他のプランはそのまま残ります。
          </p>
          <GenerationEscapeBlock
            planSetId={planSet.id}
            startedAt={
              planSet.partialOpStarts[
                (["A", "B", "C"] as const).find(
                  (s) => planSet.planProgress[s] === "generating",
                ) ?? "A"
              ]
            }
            reportLines={planSet.reportLines.filter(
              (l) =>
                l.slot != null &&
                planSet.planProgress[l.slot] === "generating",
            )}
          />
        </div>
      ) : null}
      {/* The PDF progress / completion block also lives in this row,
          directly under the A/B/C strip and above the map: the user
          presses 「PDF」 in the strip, so the result of that press has
          to appear where their eyes already are. It used to render
          inside the scrolling detail region below the map, where in
          practice it was never seen — the only visible change was a
          control appearing in the strip, which read as "nothing
          changed". */}
      {planSet.status === "done" ? <PdfExtras pdf={pdf} /> : null}
        </>
      )}
      </div>

      {/* Map. On phones it is fixed at roughly the top 32% of the screen
          height, below the switcher; at desktop widths it becomes the
          right pane and fills the full height of the split. Not
          rendered at all while 「条件」 is selected. While 地図表示 is
          OFF the cell collapses to the height of the on/off toggle
          button alone (PlanMap renders nothing else then), so the
          detail region below takes over the map's space — on desktop
          the cell likewise stops spanning the right column. */}
      {!showConditions ? (
      <div
        className={
          mapOff
            ? "col-start-1 row-start-3 mt-2 min-w-0 px-4 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:min-h-0 lg:px-0 lg:py-3"
            : "col-start-1 row-start-3 mt-3 h-[32dvh] min-w-0 px-4 lg:col-start-2 lg:row-start-1 lg:row-span-3 lg:mt-0 lg:h-auto lg:min-h-0 lg:px-0 lg:py-3"
        }
      >
        {visiblePlans.length === 0 ? (
          <p className="flex h-full items-center justify-center rounded-[var(--radius)] border border-dashed border-[var(--border)] px-3 py-2 text-center text-sm text-[var(--dim)]">
            プラン{sub}は{PROGRESS_LABELS[planSet.planProgress[sub]]}です。完了したプランは上のボタンから切り替えて見られます。
          </p>
        ) : planSet.status === "generating" ? (
          // While the set is still generating, the map is NOT mounted
          // at all (owner report, 2026-11-18: a half-finished map was
          // on screen during creation and flickered). The pins are
          // still changing underneath — each plan save used to
          // remount the whole map (the mount key covered every plan's
          // items, and each remount replays the map layer's engine
          // cascade) — so the cell holds a quiet placeholder and the
          // map appears exactly once, when creation is finished. The
          // saved plans' lists below stay readable in the meantime.
          <p className="flex h-full items-center justify-center rounded-[var(--radius)] border border-dashed border-[var(--border)] px-3 py-2 text-center text-sm text-[var(--dim)]">
            プランを作成中です。地図は、作成が終わってから表示されます。
          </p>
        ) : (
        <PlanMap
          entries={entries}
          mapKey={`${planSet.id}-${sub}-${entries
            .map(
              (e) =>
                `${e.item.id}:${e.item.lat ?? "-"},${e.item.lng ?? "-"}`,
            )
            .join("|")}`}
          pinColor={PLAN_COLORS[sub]}
          rowRefs={rowRefs}
          controllerRef={mapControllerRef}
          onVisibilityChange={handleMapVisibilityChange}
        />
        )}
      </div>
      ) : null}

      {/* Scrolling detail region, directly below the map: the summary
          heading (PlanCostHeader) at the head of the plan, then the
          detail tabs under it, in this order — スケジュール (the
          timeline list), プランの説明 (park hours, per-plan
          summaries, the generation notes as bullets, and the
          official sources), and 混雑予想 (the set's crowd forecast
          level and its basis; the tab itself is absent on sets that
          carry no forecast). Not rendered at all while 「条件」 is
          selected. */}
      {!showConditions ? (
      <div className="col-start-1 row-start-4 mt-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-4 pb-6 [overflow-wrap:anywhere] lg:row-start-3">
      {/* When this plan was made, and when it was last verified
          against official data — a plan quietly going stale is the
          failure this app exists to prevent, so both dates stay
          visible on the set itself. */}
      <p className="mt-3 text-xs text-[var(--dim)]">
        作成 {formatMonthDayJst(planSet.createdAt)}／最終検証{" "}
        {planSet.lastVerifiedAt
          ? formatMonthDayJst(planSet.lastVerifiedAt)
          : "―"}
        {planSet.verificationRunning ? (
          <span className="ml-2 font-semibold text-[var(--accent)]">
            一括検証を実行中です…
          </span>
        ) : null}
      </p>
      {planSet.rebuiltFromSetId != null ? (
        <p className="mt-3 rounded-[var(--radius)] bg-[var(--surface-alt)] px-3.5 py-2.5 text-sm leading-relaxed">
          <span className="font-semibold">作り直し版</span>
          <span className="text-[var(--dim)]">
            ：{rebuiltFromTitle ? `既存のプラン「${rebuiltFromTitle}」をもとに作り直した版です。` : "既存のプランをもとに作り直した版です。"}
            元のプランもそのまま残っています。
          </span>
        </p>
      ) : null}
      {planSet.setType === "same_day" && planSet.sameDay ? (
        <p className="mt-3 rounded-[var(--radius)] bg-[var(--surface-alt)] px-3.5 py-2.5 text-sm leading-relaxed">
          <span className="font-semibold">当日検索</span>
          <span className="text-[var(--dim)]">
            ：現在地点「{planSet.sameDay.location}」を{planSet.sameDay.startTime}
            に出発し、閉園までのプランです。現在の掲示待ち時間をもとに作られています。
            {planSet.sameDay.request
              ? `ご要望：${planSet.sameDay.request}`
              : ""}
          </span>
        </p>
      ) : null}
      {visiblePlans.length === 0 ? (
        <div className="py-10 text-center">
          <p className="font-display text-base font-bold">
            プラン{sub}：{PROGRESS_LABELS[planSet.planProgress[sub]]}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--dim)]">
            {planSet.planProgress[sub] === "generating"
              ? "このプランを作成しています。終わると、ここにスケジュールが表示されます。"
              : planSet.planProgress[sub] === "waiting"
                ? "まだ作成が始まっていません。プランはA・B・Cの順に1つずつ作っています。完了したプランは上のボタンから見られます。"
                : "このプランは作成できませんでした。完了したプランは上のボタンから見られます。"}
          </p>
          {planSet.status === "generating" ? (
            <PlanProgressList planSet={planSet} />
          ) : null}
        </div>
      ) : (
      <>
      {visiblePlans.map((p) => (
        <PlanCostHeader
          key={p.id}
          plan={p}
          priorities={planSet.priorities ?? null}
        />
      ))}

      <div
        role="tablist"
        aria-label="詳細切替"
        className="mt-3 flex gap-1.5 border-b border-[var(--border)]"
      >
        {(
          [
            { key: "schedule", label: "スケジュール" },
            { key: "about", label: "プランの説明" },
            // The crowd forecast is one of the detail tabs under the
            // summary heading, its level visible in the tab label.
            // Sets without a forecast (older sets) get no such tab.
            ...(planSet.crowdLevel != null
              ? [
                  {
                    key: "crowd",
                    label: `混雑予想 ${planSet.crowdLevel}/5`,
                  },
                ]
              : []),
          ] as { key: "schedule" | "about" | "crowd"; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeDetailTab === t.key}
            onClick={() => setDetailTab(t.key)}
            className={`-mb-px border-b-2 px-3 pb-2 pt-1 text-sm font-semibold ${
              activeDetailTab === t.key
                ? "border-[var(--accent)] text-[var(--text)]"
                : "border-transparent text-[var(--dim)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Both panels stay mounted (hidden toggle) so the timeline rows keep
          their refs and pin↔row sync with the fixed map survives tab flips. */}
      <div className={activeDetailTab === "schedule" ? undefined : "hidden"}>
        {planSet.imagesStatus === "fetching" ? (
          <div className="mt-3">
            <p className="text-sm text-[var(--dim)]">
              公式サイトから各スポットの紹介画像と公式ページへのリンクを取得しています…（取得には少し時間がかかることがあります）
            </p>
            <p className="mt-1 text-xs text-[var(--dim)]">
              10分以上終わらない場合は、取得が止まっているとみなして、もう一度取得できるボタンが自動で戻ります。
            </p>
          </div>
        ) : needsFetch ? (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={() => imageMutation.mutate()}
                disabled={imageMutation.isPending}
                className="rounded-full bg-[var(--surface-alt)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {imageMutation.isPending
                  ? "開始しています…"
                  : missingImages
                    ? "各スポットの紹介画像を取得"
                    : "各スポットの公式リンクを取得"}
              </button>
              <span className="text-xs text-[var(--dim)]">
                公式サイトの写真を優先し、取れないスポットには参考画像を表示します。各行には公式ページへのリンクも付きます
              </span>
            </div>
            {planSet.imagesStatus === "failed" ? (
              <p className="mt-2 text-xs text-[var(--dim)]">
                前回の取得はうまくいきませんでした。もう一度お試しください。
              </p>
            ) : null}
            {imageError ? (
              <p
                role="alert"
                className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
              >
                {imageError}
              </p>
            ) : null}
          </div>
        ) : null}
        <RowList
          entries={entries}
          rowRefs={rowRefs}
          showPinNumbers
          onRowTap={handleRowTap}
          dpaPrices={dpaPrices}
          onCantBuy={
            planSet.status === "done" && planSet.planProgress[sub] === "done"
              ? (item) => {
                  cantBuyMutation.reset();
                  setCantBuyNote("");
                  setCantBuyItem(item);
                }
              : undefined
          }
          onLotteryLost={
            planSet.status === "done" && planSet.planProgress[sub] === "done"
              ? (item) => {
                  lotteryMutation.reset();
                  setLotteryNote("");
                  setLotteryItem(item);
                }
              : undefined
          }
        />
      </div>
      {activeDetailTab === "about" ? (
        <div>
          {visiblePlans.map((p) =>
            p.summary ? (
              <p key={p.id} className="mt-3 text-sm leading-relaxed">
                {p.summary}
              </p>
            ) : null,
          )}

          {planSet.parkHours ? (
            <p className="mt-3 text-sm">
              <span className="font-semibold">営業時間（公式）</span>
              <span className="text-[var(--dim)]">: {planSet.parkHours}</span>
            </p>
          ) : null}

          {planSet.generationMetrics ? (
            <div className="mt-3 text-sm leading-relaxed">
              <p>
                <span className="font-semibold">作成の記録</span>
                {planSet.generationMetrics.pagesOpened != null ? (
                  <span className="text-[var(--dim)]">
                    ： 参照したページ {planSet.generationMetrics.pagesOpened}件
                  </span>
                ) : null}
              </p>
              {planSet.generationMetrics.phases.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-[var(--dim)]">
                  {planSet.generationMetrics.phases.map((ph, i) => (
                    <li key={i}>
                      ・{ph.name}：{formatPhaseSeconds(ph.seconds)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {planSet.verification ? (
            <div className="mt-3 text-sm leading-relaxed">
              <p>
                <span className="font-semibold">検証の記録</span>
                {planSet.verification.checkedAt ? (
                  <span className="text-[var(--dim)]">
                    ： {planSet.verification.checkedAt}に取得した公式データで照合
                  </span>
                ) : null}
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                {planSet.verification.checks.map((c, i) => (
                  <li key={i}>
                    <span className="font-semibold">{c.label}</span>
                    <span className="text-[var(--dim)]">：{c.result}</span>
                    {c.sourceUrl ? (
                      <>
                        {" "}
                        <a
                          href={c.sourceUrl}
                          target="_blank"
                          rel="noopener"
                          className="text-[var(--accent)] underline underline-offset-2"
                        >
                          {c.sourceTitle ?? "公式ページ"}
                        </a>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
              {planSet.verification.crowdFactors.length > 0 ? (
                <CrowdFactorsRecord
                  factors={planSet.verification.crowdFactors}
                />
              ) : null}
              {planSet.verification.dpaFacts.length > 0 ? (
                <div className="mt-1.5">
                  <p className="text-[var(--dim)]">
                    判定に使ったDPAファクト（公式情報を正規化したもの）
                    {planSet.verification.factSummary ? (
                      <span>
                        ：母集合{planSet.verification.factSummary.universeCount}
                        施設（対象{planSet.verification.factSummary.eligibleCount}
                        ／対象外
                        {planSet.verification.factSummary.notEligibleCount}
                        ／不明{planSet.verification.factSummary.unknownCount}）
                        {planSet.verification.factSummary.complete
                          ? "・全施設にファクトあり"
                          : "・不完全なビルド"}
                      </span>
                    ) : null}
                  </p>
                  <ul className="mt-1 space-y-1.5">
                    {planSet.verification.dpaFacts
                      .filter((f) => f.status === "eligible")
                      .map((f, i) => (
                        <li key={i}>
                          <span className="font-semibold">{f.name}</span>
                          <span className="text-[var(--dim)]">
                            {" "}
                            {f.priceJpy != null
                              ? `${f.priceJpy.toLocaleString("ja-JP")}円`
                              : ""}
                            {dpaPeriodSuffix(f)}
                          </span>
                          {f.snapshotUrl ? (
                            <span className="text-[var(--dim)]">
                              {" "}
                              （根拠：
                              <a
                                href={f.snapshotUrl}
                                target="_blank"
                                rel="noopener"
                                className="text-[var(--accent)] underline underline-offset-2"
                              >
                                {f.snapshotKind ?? "公式ページ"}
                              </a>
                              {f.snapshotFetchedAt
                                ? ` ${f.snapshotFetchedAt.slice(0, 10)}取得`
                                : ""}
                              ）
                            </span>
                          ) : null}
                          {f.evidence ? (
                            <span className="block text-xs text-[var(--dim)]">
                              根拠の抜粋：「{f.evidence}」
                            </span>
                          ) : null}
                        </li>
                      ))}
                  </ul>
                  {planSet.verification.dpaFacts.some(
                    (f) => f.status === "unknown",
                  ) ? (
                    <ul className="mt-1 space-y-0.5 text-[var(--dim)]">
                      {planSet.verification.dpaFacts
                        .filter((f) => f.status === "unknown")
                        .map((f, i) => (
                          <li key={i}>
                            不明：{f.name}
                            {f.unknownReason ? `（${f.unknownReason}）` : ""}
                          </li>
                        ))}
                    </ul>
                  ) : null}
                  {planSet.verification.dpaFacts.some(
                    (f) => f.status === "not_eligible",
                  ) ? (
                    <p className="mt-1 text-[var(--dim)]">
                      対象外：
                      {planSet.verification.dpaFacts
                        .filter((f) => f.status === "not_eligible")
                        .map((f) => f.name)
                        .join("、")}
                    </p>
                  ) : null}
                </div>
              ) : planSet.verification.dpaExtracted.length > 0 ? (
                <p className="mt-1.5 text-[var(--dim)]">
                  スナップショットから抽出したDPA対象：
                  {planSet.verification.dpaExtracted
                    .map(
                      (d) =>
                        `${d.name} ${d.priceJpy.toLocaleString("ja-JP")}円${dpaPeriodSuffix(d)}`,
                    )
                    .join("、")}
                </p>
              ) : null}
              {planSet.verification.unverified.length > 0 ? (
                <div className="mt-2 rounded-lg bg-amber-100 px-3 py-2 dark:bg-amber-950">
                  <p className="font-semibold text-amber-900 dark:text-amber-100">
                    未確認の項目があります
                  </p>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-amber-900 dark:text-amber-100">
                    {planSet.verification.unverified.map((u, i) => (
                      <li key={i}>{u}</li>
                    ))}
                  </ul>
                  {hasSpecSuspectUnverified(planSet.verification.unverified) ? (
                    <div className="text-amber-900 dark:text-amber-100">
                      <SpecRepairNote />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {planSet.reverifications.length > 0 ? (
            <div className="mt-3 text-sm leading-relaxed">
              <p>
                <span className="font-semibold">再検証の履歴</span>
                <span className="text-[var(--dim)]">
                  ：作成後に公式情報を取り直して照合した記録です（プランの内容は変更していません）
                </span>
              </p>
              <ul className="mt-1.5 space-y-2">
                {planSet.reverifications.map((r, i) => (
                  <li key={i}>
                    <p>
                      <span className="font-semibold">
                        {formatMonthDayJst(r.checkedAt)}の再検証
                      </span>
                      <span className="text-[var(--dim)]">
                        ：
                        {r.problems.length > 0
                          ? `差分・問題 ${r.problems.length}件`
                          : "差分なし（現在の公式情報でも有効）"}
                        {r.unverified.length > 0
                          ? `／未確認 ${r.unverified.length}件`
                          : ""}
                      </span>
                    </p>
                    {r.factSummary ? (
                      <p className="text-[var(--dim)]">
                        判定に使ったファクト
                        {r.factBuildId != null ? `（ビルド #${r.factBuildId}）` : ""}
                        ：母集合{r.factSummary.universeCount}施設（対象
                        {r.factSummary.eligibleCount}／対象外
                        {r.factSummary.notEligibleCount}／不明
                        {r.factSummary.unknownCount}）
                      </p>
                    ) : null}
                    {r.problems.length > 0 ? (
                      <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-[var(--dim)]">
                        {r.problems.map((p, j) => (
                          <li key={j}>{p}</li>
                        ))}
                      </ul>
                    ) : null}
                    {r.unverified.length > 0 ? (
                      <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-[var(--dim)]">
                        {r.unverified.map((u, j) => (
                          <li key={j}>未確認：{u}</li>
                        ))}
                      </ul>
                    ) : null}
                    {r.problems.length > 0 ||
                    hasSpecSuspectUnverified(r.unverified) ? (
                      <SpecRepairNote />
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {planSet.notes ||
          visiblePlans.some((p) => p.restaurantWaitNote) ? (
            <NotesList
              notes={planSet.notes ?? ""}
              restaurantWaitNote={
                visiblePlans.find((p) => p.restaurantWaitNote)
                  ?.restaurantWaitNote ?? null
              }
            />
          ) : null}

          {planSet.sources.length > 0 ? (
            <div className="mt-6 border-t border-[var(--border)] pt-3">
              <p className="text-xs font-semibold text-[var(--dim)]">
                作成時に確認した公式ページ
              </p>
              <ul className="mt-1.5 space-y-1">
                {planSet.sources.map((s) => (
                  <li key={s.url} className="text-sm">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener"
                      className="text-[var(--accent)] underline underline-offset-2"
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {planSet.estimateSources.length > 0 ? (
            <div className="mt-4 border-t border-[var(--border)] pt-3">
              <p className="text-xs font-semibold text-[var(--dim)]">
                待ち時間の推定に使った材料（参考サイト）
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
                公式情報ではありません。待ち時間の読みの材料として作成時に参照した、実績集計サイトです。
              </p>
              <ul className="mt-1.5 space-y-1">
                {planSet.estimateSources.map((s) => (
                  <li key={s.url} className="text-sm">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener"
                      className="text-[var(--accent)] underline underline-offset-2"
                    >
                      {s.title}
                    </a>
                    {s.fetchedAt ? (
                      <span className="text-[var(--dim)]">
                        （取得日：{s.fetchedAt}）
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {activeDetailTab === "crowd" && planSet.crowdLevel != null ? (
        <div>
          {/* The set's crowd forecast: the level as a 5-step scale,
              then the basis the forecast was judged on — both are
              the set's stored premise (plan_sets.crowd_level /
              crowd_basis), shown as saved, never re-derived here. */}
          <div className="mt-4 flex items-end gap-3">
            <p className="font-display text-3xl font-bold leading-none">
              {planSet.crowdLevel}
              <span className="ml-1 text-base font-semibold text-[var(--dim)]">
                / 5
              </span>
            </p>
            <div
              className="flex flex-1 gap-1 pb-1"
              role="img"
              aria-label={`混雑予想は5段階中${planSet.crowdLevel}`}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <span
                  key={n}
                  className={`h-2.5 flex-1 rounded-full ${
                    n <= (planSet.crowdLevel ?? 0)
                      ? "bg-[var(--accent)]"
                      : "bg-[var(--surface-alt)]"
                  }`}
                />
              ))}
            </div>
          </div>
          <p className="mt-2 text-sm text-[var(--dim)]">
            5に近いほど混雑が予想される日です。
          </p>
          {planSet.crowdBasis ? (
            <div className="mt-4 text-sm leading-relaxed">
              <p className="font-semibold">根拠</p>
              <p className="mt-1 whitespace-pre-wrap">{planSet.crowdBasis}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      </>
      )}

      {/* Fixed closing line of every plan display (owner's design,
          2026-11-17): the visible form of the core contract — if
          something bothers you, say so in the AI chat below and it
          can be fixed. Display layer ONLY: a fixed literal rendered
          here deterministically, never stored in plan data, never
          part of the PDF payload or the verification package (the
          PDF's reader has no AI at hand). Sits at the very end of
          the displayed plan, directly before the 2重検証 button,
          under the same condition as that button.
          Owner's follow-up decision (2026-11-17): rendered as a
          prominent call-out banner, NOT a small footnote — most
          first-time readers don't yet know the plan can be
          customized by asking the AI, so the point of this block is
          that they NOTICE it can be fixed. Larger type than the
          body, accent border and tinted background set it apart
          from the surrounding notes. */}
      {planSet.status === "done" && visiblePlans.length > 0 ? (
        <div
          role="note"
          aria-label="プランの直し方の案内"
          className="mt-6 rounded-[var(--radius)] border-2 border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))] px-4 py-4 sm:px-5"
        >
          <p className="font-display text-lg font-bold leading-relaxed sm:text-xl">
            気になるところがあれば、下のAIチャットで気軽に教えてください。待ち時間を減らしたり、順番を変えたり、作り直したりできます。
          </p>
        </div>
      ) : null}

      {/* 「他のAIで2重検証」: at the very end of the displayed plan,
          below whichever detail tab is open. Finished sets only —
          the package is assembled from the saved plan. */}
      {planSet.status === "done" && visiblePlans.length > 0 ? (
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <button
            onClick={() => verifyMutation.mutate(sub)}
            disabled={verifyMutation.isPending}
            aria-label={`プラン${sub}を他のAIで2重検証するためのデータを開く`}
            className="w-full rounded-full border-2 border-[var(--accent)] px-4 py-2.5 text-base font-bold text-[var(--accent)] disabled:opacity-50"
          >
            {verifyMutation.isPending ? "取得しています…" : "他のAIで2重検証"}
          </button>
          <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
            このプランの条件・前提・スケジュール・費用・参照した情報をまとめた検証用データをコピーして、他のAIに貼り付けて確かめてもらえます。
          </p>
          {verifyError && !verifyDialogOpen ? (
            <p
              role="alert"
              className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
            >
              {verifyError}
            </p>
          ) : null}
        </div>
      ) : null}

      </div>
      ) : null}

      {/* 「抽選に外れたら？」 confirmation: the same pattern as the
          「買えなかったら？」 dialog below — always shown before any
          reschedule starts, the premise (which show's lottery was
          lost, in which plan) attached automatically, the free-text
          field for what happened instead. Cancelling starts
          nothing. */}
      {lotteryItem ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="抽選に外れた場合のリスケジュールの確認"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={() => {
            if (!lotteryMutation.isPending) setLotteryItem(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-[var(--radius)] bg-[var(--surface)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display text-base font-bold">
              プラン{sub}：{lotteryItem.name}
              {lotteryItem.timeLabel
                ? `（公演 ${lotteryItem.timeLabel}）`
                : ""}
            </p>
            <p className="mt-2 text-sm leading-relaxed">
              このショーの抽選に外れた場合の、その後のスケジュールを新しく作りますか？
            </p>
            <label
              className="mt-3 block text-sm font-semibold"
              htmlFor={`lottery-note-${planSet.id}`}
            >
              今の状況を教えてください（任意）
            </label>
            <textarea
              {...FIELDS.requestLotteryReschedule.userNote}
              id={`lottery-note-${planSet.id}`}
              value={lotteryNote}
              onChange={(e) => setLotteryNote(e.target.value)}
              rows={3}
              placeholder="例：代わりにこのショーのDPAを買ったので、それを入れて組み直して／全面的にリスケしてよい"
              className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm leading-relaxed"
            />
            {lotteryError ? (
              <p
                role="alert"
                className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
              >
                {lotteryError}
              </p>
            ) : null}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() =>
                  lotteryMutation.mutate({
                    slot: sub,
                    item: lotteryItem,
                    note: lotteryNote,
                  })
                }
                disabled={lotteryMutation.isPending}
                className="flex-1 rounded-full bg-[var(--accent)] px-4 py-2.5 font-semibold text-white disabled:opacity-50"
              >
                {lotteryMutation.isPending ? "開始しています…" : "作り直す"}
              </button>
              <button
                onClick={() => setLotteryItem(null)}
                disabled={lotteryMutation.isPending}
                className="flex-1 rounded-full bg-[var(--surface-alt)] px-4 py-2.5 font-semibold disabled:opacity-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 「買えなかったら？」 confirmation: always shown before any
          reschedule starts. The free-text field is the same channel
          as the chat composer, with one difference — the premise
          (which DPA could not be bought, in which plan) is attached
          automatically. Empty is fine: the premise alone then drives
          the reschedule. Cancelling starts nothing. */}
      {cantBuyItem ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="買えなかった場合のリスケジュールの確認"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={() => {
            if (!cantBuyMutation.isPending) setCantBuyItem(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-[var(--radius)] bg-[var(--surface)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display text-base font-bold">
              プラン{sub}：{cantBuyItem.name}
              {cantBuyItem.dpaPurchaseTime
                ? `（購入 ${cantBuyItem.dpaPurchaseTime}）`
                : ""}
            </p>
            <p className="mt-2 text-sm leading-relaxed">
              このチケットを買えなかった場合の、その後のスケジュールを新しく作りますか？
            </p>
            <label
              className="mt-3 block text-sm font-semibold"
              htmlFor={`cantbuy-note-${planSet.id}`}
            >
              今の状況を教えてください（任意）
            </label>
            <textarea
              {...FIELDS.requestDpaReschedule.userNote}
              id={`cantbuy-note-${planSet.id}`}
              value={cantBuyNote}
              onChange={(e) => setCantBuyNote(e.target.value)}
              rows={3}
              placeholder="例：代わりに〇〇のDPAを買ったので、それを入れて組み直して／全面的にリスケしてよい"
              className="mt-1.5 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm leading-relaxed"
            />
            {cantBuyError ? (
              <p
                role="alert"
                className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
              >
                {cantBuyError}
              </p>
            ) : null}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() =>
                  cantBuyMutation.mutate({
                    slot: sub,
                    item: cantBuyItem,
                    note: cantBuyNote,
                  })
                }
                disabled={cantBuyMutation.isPending}
                className="flex-1 rounded-full bg-[var(--accent)] px-4 py-2.5 font-semibold text-white disabled:opacity-50"
              >
                {cantBuyMutation.isPending ? "開始しています…" : "作り直す"}
              </button>
              <button
                onClick={() => setCantBuyItem(null)}
                disabled={cantBuyMutation.isPending}
                className="flex-1 rounded-full bg-[var(--surface-alt)] px-4 py-2.5 font-semibold disabled:opacity-50"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 「他のAIで2重検証」 dialog: the fetched package, a copy
          button (Clipboard API), and — always visible — the full
          package in a read-only selectable textarea as the manual
          copy fallback for environments where the clipboard write
          fails. */}
      {verifyDialogOpen && verifyText ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="他のAIで2重検証"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={() => setVerifyDialogOpen(false)}
        >
          <div
            className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-[var(--radius)] bg-[var(--surface)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display text-base font-bold">他のAIで2重検証</p>
            <p className="mt-2 text-sm leading-relaxed">
              このプランの検証用データをコピーします。参考にしたサイト、検索条件、スケジュールなどを全てクリップボードにコピーします。そのまま他のAIに貼り付けてください。検証そのものは、貼り付け先のAIが行います。
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleCopyPackage}
                className="flex-1 rounded-full bg-[var(--accent)] px-4 py-2.5 font-semibold text-[var(--accent-text)]"
              >
                クリップボードにコピー
              </button>
              <button
                onClick={() => setVerifyDialogOpen(false)}
                className="flex-1 rounded-full bg-[var(--surface-alt)] px-4 py-2.5 font-semibold"
              >
                閉じる
              </button>
            </div>
            {copyState === "copied" ? (
              <p
                role="status"
                className="mt-2 rounded-lg bg-[var(--surface-alt)] px-3 py-2 text-sm font-semibold"
              >
                コピーしました。他のAIに貼り付けてください。
              </p>
            ) : null}
            {copyState === "failed" ? (
              <p
                role="alert"
                className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
              >
                この環境ではクリップボードへコピーできませんでした。下のテキストエリアの内容を選択して、手動でコピーしてください。
              </p>
            ) : null}
            <label
              className="mt-3 block text-sm font-semibold"
              htmlFor={`verify-package-${planSet.id}`}
            >
              検証用データ（全文）
            </label>
            <textarea
              id={`verify-package-${planSet.id}`}
              readOnly
              value={verifyText}
              rows={12}
              className="mt-1.5 min-h-0 w-full flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs leading-relaxed"
            />
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--dim)]">
              コピーがうまくいかない場合は、この欄の内容を手動でコピーできます。
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// PDF export (finished plan sets only). The PDF covers the whole
// set (A/B/C, static maps with numbered pins, cost breakdowns,
// schedules, descriptions, notes, sources) and is rendered inside
// the app from the LOCALLY generated file; no public link is
// created, and the user hands the file over themselves (LINE,
// mail, …). The button sits at the right end of the A/B/C sub-tab
// strip; this hook holds the export state shared by that button
// and the status block in the banner row directly under the strip.
//
// Delivery — the save control follows what the CURRENT shell can
// actually do with a file, because the shells differ (owner
// reports, 2026-11-18: in Chrome the PDF could be created but
// 「保存・共有する」 did nothing at all — desktop Chrome's share
// sheet cannot take files — and the owner ruled that Chrome and
// the desktop Muse app should simply get a download button):
// - Where the share sheet can take files (the phone shells,
//   proven on the owner's phone: `navigator.canShare({files})`
//   answers true), saving is the share sheet fed with the locally
//   generated File (「保存・共有する」 → ファイルに保存 / LINE /
//   メール) — the one route proven to save a real, openable file
//   there. Download anchors stay OFF that shell: the owner
//   reported them doing nothing useful in the phone WebView (the
//   file was handed out to an external app instead of saved).
// - Where the share sheet cannot take files (Chrome, the desktop
//   Muse app), the save control is a plain 「ダウンロード」: a
//   REAL <a download> anchor whose href is an object URL minted
//   from the same local File at generation time. The user taps
//   the anchor itself, inside their own gesture — never a
//   programmatic click fired after an await (that is the shape
//   the phone shell kept turning into a navigation; see below).
// - Viewing: the generated page canvases THEMSELVES
//   (PdfPagesViewer) — the exact pixels the PDF was encoded
//   from. No file fetch, no storage round trip, no PDF parser.
//   They are shown in a full-screen overlay (PdfPreviewOverlay),
//   NOT inline in this banner row: inline, the auto-opened pages
//   grew this grid row by thousands of pixels, which resized and
//   displaced the map's grid area and broke the on-screen map
//   (owner report, 2026-11-18: 「PDFを作成すると、画面に表示され
//   ている地図が崩れる」). The overlay is out of flow, so PDF
//   creation can no longer change the map's layout at all; the
//   map layer additionally re-measures itself whenever its frame
//   changes size (see PlanMap's refreshSize wiring).
// - The file name carries its creation timestamp (to the minute,
//   Asia/Tokyo), and the completion block displays the same
//   timestamp and the file name: the owner can cross-check that
//   the file in hand is the one just made — and a file or screen
//   WITHOUT the timestamp is an older build, which is how a phone
//   still showing a cached page is told apart from a live bug.
// Also removed after repeated on-device failure: the chained
// fallback that attempted a share and, when that failed, fired a
// PROGRAMMATIC click on a temporary download anchor, and every
// real <a download> anchor as well. That click happens outside
// the user's tap gesture, and the shell treated it as a page
// navigation rather than a download — the owner kept landing on
// an authentication page (「copilotに飛ぶ」) even after every
// server-URL control was gone; a genuine download anchor the
// owner tapped themselves likewise did nothing useful in the
// phone WebView (the file was handed out to an external app —
// Copilot, then Chrome — instead of being saved). That history
// is why the download anchor is served ONLY to shells whose
// share sheet cannot take files (Chrome / desktop Muse, where
// the owner explicitly asked for it) and never to the phone
// shell, which keeps the proven share route alone.
// Removed after repeated on-device failure: every control that
// pointed at the server-stored copy's URL (ctx.blobs.getUrl
// returns a RELATIVE ./blobs/… URL). Inside the app that URL
// loads fine (the facility photos prove it), but as a download
// the phone hands it OUT of the app — where the app session does
// not follow — and the owner got, in turn, a black viewer page, a
// bare file name, and an authentication page instead of the PDF;
// the same bytes saved through the share sheet into a notes app
// displayed perfectly, which is what convicts the URL route and
// acquits the file. The savePlanPdf action still exists on the
// server (integrity-checked storage) but the client no longer
// uploads for a download link nothing may point at.
//
// The completion block can be DISMISSED (its × button): an
// earlier build left 「PDFができました」 on screen with no way to
// remove it — reported, accurately, as a section that cannot be
// deleted. Dismissing clears the generated result entirely; the
// PDF button simply generates a fresh copy on the next press.
//
// Placement and auto-open: the completion block renders in the
// banner row directly under the A/B/C strip (above the map), and
// its preview opens by itself when a generation completes — as a
// full-screen overlay above everything (see the delivery note:
// inline in this row, the pages broke the map's layout). An
// earlier build rendered the block inside the scrolling detail
// region below the map; on the owner's phone the only change
// visible where they were looking was a control in the strip
// appearing — reported, accurately, as "nothing changed".
