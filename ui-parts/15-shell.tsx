// ---------------------------------------------------------------- app shell

export function App() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>("chat");
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
  const [planSlotBySet, setPlanSlotBySet] = useState<Record<number, SubTab>>(
    {},
  );
  // One-shot prefill for the プラン作成 tab's 当日検索 section, set
  // by a same-day plan tab's 「条件を変えて再検索」; the conditions
  // form consumes it on mount and clears it (see ConditionsView), so
  // a later ordinary visit to the tab never re-applies it.
  const [sameDayPrefill, setSameDayPrefill] =
    useState<SameDayPrefill | null>(null);
  const [longPressTarget, setLongPressTarget] = useState<PlanSet | null>(null);
  const pressTimer = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Day-before （前日） dialog: getState offers a target at most once
  // per plan set (the server records the showing). The offered target
  // is captured into local state the moment it appears — and marked
  // shown on the server at the same moment — so a later refetch can
  // never make the dialog vanish while it is being read, and it can
  // never appear twice.
  const [eveDialog, setEveDialog] = useState<{
    planSetId: number;
    title: string;
    visitDate: string;
  } | null>(null);
  const eveMarkedRef = useRef<number | null>(null);
  // Announcement dialog (spec §22.1): checked once when the space is
  // opened (the effect below). The server returns display data only
  // for a newly saved announcement with a non-empty title; anything
  // else — no news, an already-read version, a failed fetch — comes
  // back as "do not show" and nothing ever appears. When the
  // day-before dialog also applies on the same open, the
  // announcement waits: its render is gated on the eve dialog being
  // gone, so the two never stack (spec §27.2).
  const [announcement, setAnnouncement] = useState<{
    title: string;
    body: string;
  } | null>(null);
  const announceCheckedRef = useRef(false);
  useEffect(() => {
    if (announceCheckedRef.current) return;
    announceCheckedRef.current = true;
    void api
      .checkAnnouncement({})
      .then((res) => {
        if (res.show && res.title != null) {
          setAnnouncement({ title: res.title, body: res.body ?? "" });
        }
      })
      .catch(() => undefined);
  }, []);

  const stateQuery = useQuery({
    queryKey: ["state"],
    queryFn: () => api.getState({}),
    refetchInterval: (query) =>
      query.state.data?.planSets.some(
        (s) =>
          s.status === "generating" ||
          s.imagesStatus === "fetching" ||
          // A partial replacement in flight: the set stays "done"
          // while one slot is 作成中 — keep polling so the swap (and
          // its chat announcement) lands without a manual reload.
          Object.values(s.planProgress).some((p) => p === "generating"),
      ) ||
      query.state.data?.researchPending ||
      query.state.data?.waitTimeSourcesPending ||
      query.state.data?.verificationPending
        ? 4000
        : false,
  });

  const sendMutation = useMutation({
    mutationFn: (vars: { text: string; openTab: OpenTabArg }) =>
      api.sendMessage(vars),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      if (res.generationStarted != null) setActiveTab(res.generationStarted);
    },
    // Settle ALWAYS refetches the state, not only on success: the
    // server saves the user message before inference and the reply
    // when it is ready, so if the response itself is lost (timeout,
    // connection drop) the saved reply must still surface in the
    // chat instead of leaving the user with "no reply".
    onSettled: () => {
      setPendingText(null);
      queryClient.invalidateQueries({ queryKey: ["state"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deletePlanSet({ planSetId: id }),
    onSuccess: (_res, id) => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      if (activeTab === id) setActiveTab("chat");
      setLongPressTarget(null);
    },
  });

  // The dialog's 「一括検証を実行する」: starts the verification of
  // exactly the set the dialog named (the server announces the start
  // in the chat from the actual start result) and closes the dialog.
  const eveVerifyMutation = useMutation({
    mutationFn: (id: number) => api.requestPlanVerification({ planSetId: id }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["state"] });
      if (res.ok) setEveDialog(null);
    },
  });
  const eveError =
    eveVerifyMutation.data && !eveVerifyMutation.data.ok
      ? eveVerifyMutation.data.error
      : eveVerifyMutation.isError
        ? "一括検証を開始できませんでした。少し待ってもう一度お試しください。"
        : null;

  const eveTarget = stateQuery.data?.eveVerification ?? null;
  useEffect(() => {
    if (!eveTarget || eveMarkedRef.current === eveTarget.planSetId) return;
    eveMarkedRef.current = eveTarget.planSetId;
    setEveDialog(eveTarget);
    void api
      .markEveDialogShown({ planSetId: eveTarget.planSetId })
      .catch(() => undefined);
  }, [eveTarget]);

  // Task-manager congestion dialog: getState offers an unshown
  // notice when one of the auxiliary production processings
  // (wait-time site list update / image fetch / restaurant fact
  // correction) exhausted its attempts under the task manager.
  // Like the day-before dialog, the offered notice is captured
  // into local state the moment it appears — and marked shown on
  // the server at the same moment — so it displays exactly once
  // and a later refetch can never make it vanish mid-read.
  const [mgrNotice, setMgrNotice] = useState<{
    id: number;
    text: string;
  } | null>(null);
  const mgrNoticeMarkedRef = useRef<number | null>(null);
  const mgrNoticeTarget = stateQuery.data?.mgrDialogNotice ?? null;
  useEffect(() => {
    if (!mgrNoticeTarget || mgrNoticeMarkedRef.current === mgrNoticeTarget.id)
      return;
    mgrNoticeMarkedRef.current = mgrNoticeTarget.id;
    setMgrNotice(mgrNoticeTarget);
    void api
      .markMgrDialogShown({ noticeId: mgrNoticeTarget.id })
      .catch(() => undefined);
  }, [mgrNoticeTarget]);

  const state = stateQuery.data;
  const activePlanSet =
    typeof activeTab === "number"
      ? state?.planSets.find((s) => s.id === activeTab)
      : undefined;
  const effectiveTab: TabKey =
    typeof activeTab === "number" && state && !activePlanSet
      ? "chat"
      : activeTab;

  const startLongPress = (set: PlanSet) => {
    pressTimer.current = window.setTimeout(() => setLongPressTarget(set), 600);
  };
  const cancelLongPress = () => {
    if (pressTimer.current != null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  // Desktop drag/wheel sideways scrolling for the tab strip; a drag
  // also cancels any long-press delete pending on the tab it began on.
  const tabBarRef = useDragScroll<HTMLDivElement>(cancelLongPress);

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
    const openTab: OpenTabArg =
      effectiveTab === "chat"
        ? { kind: "chat" }
        : effectiveTab === "conditions"
          ? { kind: "conditions" }
          : effectiveTab === "waitsources"
            ? { kind: "waitsources" }
            : effectiveTab === "help"
              ? { kind: "help" }
              : effectiveTab === "debug" || effectiveTab === "taskmgr"
                ? // The debug / task-manager tabs carry no plan
                  // reference; a message sent from them resolves
                  // plan mentions exactly like one sent from the
                  // chat tab.
                  { kind: "chat" }
                : {
                kind: "planSet",
                planSetId: effectiveTab,
                slot: planSlotBySet[effectiveTab] ?? "A",
              };
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setPendingText(text);
    sendMutation.mutate({ text, openTab });
    setActiveTab("chat");
  };

  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !composing && !e.nativeEvent.isComposing) {
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
      {/* Tab bar: the 裏タスク管理 tab leads (owner's instruction,
          2026-11-20), then the debug tab, TAB1/TAB2 fixed, plan tabs
          appended. Pinned to the top of the screen (sticky) so it
          never scrolls away. */}
      <div
        ref={tabBarRef}
        role="tablist"
        aria-label="タブ"
        className="pt-safe sticky top-0 z-30 flex w-full min-w-0 shrink-0 cursor-grab gap-1.5 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2"
      >
        <TabButton
          label="裏タスク管理"
          active={effectiveTab === "taskmgr"}
          onClick={() => setActiveTab("taskmgr")}
        />
        <TabButton
          label="デバッグ"
          active={effectiveTab === "debug"}
          onClick={() => setActiveTab("debug")}
        />
        <TabButton
          label="AIチャット"
          active={effectiveTab === "chat"}
          onClick={() => setActiveTab("chat")}
        />
        <TabButton
          label="プラン作成"
          active={effectiveTab === "conditions"}
          onClick={() => setActiveTab("conditions")}
        />
        <TabButton
          label="待ち時間参考サイト"
          active={effectiveTab === "waitsources"}
          badge={state?.waitTimeSourcesPending ? "更新中" : undefined}
          onClick={() => setActiveTab("waitsources")}
        />
        <TabButton
          label="もっとこうして！"
          active={effectiveTab === "help"}
          onClick={() => setActiveTab("help")}
        />
        {state?.planSets.map((s) => (
          <TabButton
            key={s.id}
            // Same-title sets are told apart by the "(N) " sequence
            // number stored at the FRONT of the set's title; it leads
            // the tab label too, since the label's end is what gets
            // truncated in the strip.
            label={`${/^\(\d+\)\s/.exec(s.title)?.[0] ?? ""}${formatDateLabel(s.visitDate)} ${parkLabel(s.park)}`}
            active={effectiveTab === s.id}
            badge={s.status === "generating" ? "作成中" : s.status === "failed" ? "失敗" : s.status === "done" && Object.values(s.planProgress).some((p) => p === "generating") ? "差し替え中" : s.setType === "same_day" ? "当日検索" : s.rebuiltFromSetId != null ? "作り直し版" : undefined}
            onClick={() => setActiveTab(s.id)}
            onLongPress={() => startLongPress(s)}
            onLongPressEnd={cancelLongPress}
          />
        ))}
      </div>

      {/* Content. Plan tabs drop the centered max-width at lg and up so
          their two-pane split spans the full display width; every other
          tab (and every tab below lg) keeps the centered column. */}
      <main
        className={`mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col ${
          typeof effectiveTab === "number" && activePlanSet
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
              onClick={() => stateQuery.refetch()}
              className="mt-3 rounded-full bg-[var(--surface-alt)] px-4 py-2 text-sm font-semibold"
            >
              もう一度試す
            </button>
          </div>
        ) : effectiveTab === "chat" ? (
          <ChatView
            state={state}
            onGoToSearch={() => setActiveTab("conditions")}
            sending={sendMutation.isPending}
            pendingText={pendingText}
            researchPending={state.researchPending}
            waitSourcesPending={state.waitTimeSourcesPending}
            verificationPending={state.verificationPending}
          />
        ) : effectiveTab === "conditions" ? (
          <ConditionsView
            conditions={state.conditions}
            onSaved={() => undefined}
            onGenerated={(id) => setActiveTab(id)}
            sameDayPrefill={sameDayPrefill}
            onSameDayPrefillConsumed={() => setSameDayPrefill(null)}
          />
        ) : effectiveTab === "waitsources" ? (
          <WaitSourcesView
            sources={state.waitTimeSources}
            pending={state.waitTimeSourcesPending}
          />
        ) : effectiveTab === "help" ? (
          <CustomizeHelpView promptVersion={state?.promptVersion} />
        ) : effectiveTab === "debug" ? (
          <DebugView />
        ) : effectiveTab === "taskmgr" ? (
          <TaskMgrView />
        ) : activePlanSet ? (
          <PlanSetView
            key={activePlanSet.id}
            planSet={activePlanSet}
            rebuiltFromTitle={
              activePlanSet.rebuiltFromSetId != null
                ? (state.planSets.find((x) => x.id === activePlanSet.rebuiltFromSetId)?.title ?? null)
                : null
            }
            selectedSlot={planSlotBySet[activePlanSet.id] ?? "A"}
            onSelectSlot={(slot) =>
              setPlanSlotBySet((prev) => ({
                ...prev,
                [activePlanSet.id]: slot,
              }))
            }
            onResearch={(prefill) => {
              setSameDayPrefill(prefill);
              setActiveTab("conditions");
            }}
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
        ) : state?.researchPending ? (
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
                AIが公式サイトで確認しています…
              </span>
            </p>
            <p className="mt-1 text-center text-xs text-[var(--dim)]">
              回答ができたら、AIチャットに表示されます。
            </p>
          </div>
        ) : state?.waitTimeSourcesPending ? (
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
                AIが待ち時間参考サイトを更新しています…
              </span>
            </p>
            <p className="mt-1 text-center text-xs text-[var(--dim)]">
              更新が終わったら、AIチャットと「待ち時間参考サイト」タブに表示されます。
            </p>
          </div>
        ) : state?.verificationPending ? (
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
                AIがプランの一括検証をしています…
              </span>
            </p>
            <p className="mt-1 text-center text-xs text-[var(--dim)]">
              公式情報を取り直して照合しています。結果は、AIチャットに表示されます。
            </p>
          </div>
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
            {...FIELDS.sendMessage.text}
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

      {/* Day-before （前日） dialog: shown once per plan set, when the
          space is opened on the day before its visit date. The
          wording is the user's own; the only addition is the small
          line naming the target plan. Executing starts the bulk
          re-verification of that set (results arrive in the AI chat
          tab); closing leaves the same verification available from
          the chat with 「検証して」. */}
      {eveDialog ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="前日のお知らせ"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
        >
          <div className="w-full max-w-sm rounded-[var(--radius)] bg-[var(--surface)] p-5">
            <p className="text-xs text-[var(--dim)]">
              対象のプラン：「{eveDialog.title}」（{formatDateLabel(eveDialog.visitDate)} 来園）
            </p>
            <p className="font-display mt-2 text-lg font-bold">
              明日はいよいよ当日ですね！
            </p>
            <p className="mt-2 text-sm leading-relaxed">
              ディズニーは頻繁に情報が更新されます。アトラクションの営業時間や工事など。
            </p>
            <p className="mt-2 text-sm leading-relaxed">
              現在のプランが正しいか、検証しておきましょう。プランの内容は変更しません。
            </p>
            <p className="mt-2 text-sm leading-relaxed">
              検証結果はAIチャットタブでお知らせします。
            </p>
            {eveError ? (
              <p
                role="alert"
                className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100"
              >
                {eveError}
              </p>
            ) : null}
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => eveVerifyMutation.mutate(eveDialog.planSetId)}
                disabled={eveVerifyMutation.isPending}
                className="flex-1 rounded-full bg-[var(--accent)] px-4 py-2.5 font-semibold text-white disabled:opacity-50"
              >
                {eveVerifyMutation.isPending
                  ? "開始しています…"
                  : "一括検証を実行する"}
              </button>
              <button
                onClick={() => setEveDialog(null)}
                disabled={eveVerifyMutation.isPending}
                className="flex-1 rounded-full bg-[var(--surface-alt)] px-4 py-2.5 font-semibold disabled:opacity-50"
              >
                後で
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Announcement dialog (spec §22.1): the title is the heading
          and the body is the distributor's HTML, rendered as HTML —
          the server sanitizes the body with an allowlist sanitizer
          before storing/returning it, so only formatting markup
          (and https links) can ever reach this innerHTML.
          When the day-before dialog applies on the same open it
          comes first: this dialog renders only once there is no eve
          target and no eve dialog on screen, so the two never
          overlap, and closing the eve dialog lets this one appear. */}
      {!eveDialog && !eveTarget && announcement ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="お知らせ"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
        >
          <div className="w-full max-w-sm rounded-[var(--radius)] bg-[var(--surface)] p-5">
            <p className="font-display text-lg font-bold">
              {announcement.title}
            </p>
            <div
              className="mt-2 text-sm leading-relaxed [&_a]:underline [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: announcement.body }}
            />
            <div className="mt-4 flex">
              <button
                onClick={() => setAnnouncement(null)}
                className="flex-1 rounded-full bg-[var(--accent)] px-4 py-2.5 font-semibold text-white"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Task-manager congestion dialog: shown when an auxiliary
          production processing (wait-time site list update /
          image fetch / restaurant fact correction) exhausted its
          attempts. The body is the one common congestion text,
          verbatim from the server. It yields to the day-before
          dialog and the announcement dialog so dialogs never
          stack; it appears once they are gone. */}
      {!eveDialog && !eveTarget && !announcement && mgrNotice ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="混雑のお知らせ"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
        >
          <div className="w-full max-w-sm rounded-[var(--radius)] bg-[var(--surface)] p-5">
            <p className="text-sm leading-relaxed">{mgrNotice.text}</p>
            <div className="mt-4 flex">
              <button
                onClick={() => setMgrNotice(null)}
                className="flex-1 rounded-full bg-[var(--accent)] px-4 py-2.5 font-semibold text-white"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Long-press delete confirmation for plan tabs. */}
      {longPressTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="タブ削除の確認"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={() => setLongPressTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-[var(--radius)] bg-[var(--surface)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display text-base font-bold">
              「{longPressTarget.title}」を削除しますか？
            </p>
            <p className="mt-2 text-sm text-[var(--dim)]">
              このタブのプラン（A/B/C）はすべて消えます。元に戻せません。
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => deleteMutation.mutate(longPressTarget.id)}
                className="flex-1 rounded-full bg-red-700 px-4 py-2.5 font-semibold text-white"
              >
                削除する
              </button>
              <button
                onClick={() => setLongPressTarget(null)}
                className="flex-1 rounded-full bg-[var(--surface-alt)] px-4 py-2.5 font-semibold"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TabButton({
  label,
  active,
  badge,
  onClick,
  onLongPress,
  onLongPressEnd,
}: {
  label: string;
  active: boolean;
  badge?: string;
  onClick: () => void;
  onLongPress?: () => void;
  onLongPressEnd?: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      onPointerDown={onLongPress}
      onPointerUp={onLongPressEnd}
      onPointerLeave={onLongPressEnd}
      onPointerCancel={onLongPressEnd}
      onContextMenu={onLongPress ? (e) => e.preventDefault() : undefined}
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
