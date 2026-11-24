function ConditionsView({
  conditions,
  onSaved,
  onGenerated,
  sameDayPrefill,
  onSameDayPrefillConsumed,
}: {
  conditions: Conditions;
  onSaved: () => void;
  onGenerated: (planSetId: number) => void;
  // A same-day set's 「条件を変えて再検索」 prefill for the 当日検索
  // section at the bottom of this tab; consumed on mount (below) so
  // it applies exactly once.
  sameDayPrefill: SameDayPrefill | null;
  onSameDayPrefillConsumed: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Conditions>(conditions);
  const dirtyRef = useRef(false);
  const syncedRef = useRef<string>(JSON.stringify(conditions));
  // The numeric fields （予算・大人・子ども） hold the typed STRING
  // while editing (記録AQ): a field can be cleared with backspace
  // and stay empty — empty means 未入力 — and the text is parsed
  // into numbers only when 保存 or 作成 is pressed. (Before this,
  // the inputs parsed on every keystroke, so clearing a field
  // instantly snapped it back to 0 and the 0 could not be deleted.)
  const [budgetText, setBudgetText] = useState<string>(() =>
    conditions.budgetJpy != null ? String(conditions.budgetJpy) : "",
  );
  const [adultsText, setAdultsText] = useState<string>(() =>
    String(conditions.adults),
  );
  const [childrenText, setChildrenText] = useState<string>(() =>
    String(conditions.children),
  );
  const [formError, setFormError] = useState<string | null>(null);

  // Adopt server-side changes (e.g. another device, agent edits) only while
  // the user has no unsaved edits in the form.
  useEffect(() => {
    const incoming = JSON.stringify(conditions);
    if (!dirtyRef.current && incoming !== syncedRef.current) {
      syncedRef.current = incoming;
      setForm(conditions);
      setBudgetText(
        conditions.budgetJpy != null ? String(conditions.budgetJpy) : "",
      );
      setAdultsText(String(conditions.adults));
      setChildrenText(String(conditions.children));
    }
  }, [conditions]);

  // The 当日検索 prefill is one-shot: the section below captured it
  // as its initial values during this mount, so clear it from the
  // shell now — a later ordinary visit to this tab must not have
  // the old same-day inputs re-applied over what the user typed.
  useEffect(() => {
    if (sameDayPrefill) onSameDayPrefillConsumed();
  }, [sameDayPrefill, onSameDayPrefillConsumed]);

  const set = <K extends keyof Conditions>(key: K, value: Conditions[K]) => {
    dirtyRef.current = true;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const saveMutation = useMutation({
    mutationFn: (c: Conditions) => api.saveConditions(c),
    onSuccess: () => {
      dirtyRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["state"] });
      onSaved();
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (c: Conditions) => {
      await api.saveConditions(c);
      return api.requestPlanGeneration({});
    },
    onSuccess: (res) => {
      dirtyRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["state"] });
      if (res.ok && res.planSetId != null) onGenerated(res.planSetId);
    },
  });

  const genError =
    generateMutation.data && !generateMutation.data.ok
      ? generateMutation.data.error
      : generateMutation.isError
        ? "プラン作成を開始できませんでした。少し待ってもう一度お試しください。"
        : null;

  // Press-time handling for 「この条件で3プランを作成」 (記録AQ):
  // the numeric texts are parsed here, and only here. Adults
  // unentered or 0 — a party that cannot exist — and budget
  // unentered or 0 — an unentered field, not a budget — stop the
  // press with the reason shown in place; generation never starts.
  // No other judgement is made about the amount. Children
  // unentered or 0 fix the party at 0 children and never block.
  const handleGenerate = () => {
    const adults = parseNumericText(adultsText);
    if (adults == null || adults < 1) {
      setFormError(
        "大人の人数が入力されていません（0人では作成できません）。大人1人以上を入力してください。",
      );
      return;
    }
    const budget = parseNumericText(budgetText);
    if (budget == null || budget < 1) {
      setFormError(
        "予算が入力されていません（0円では作成できません）。チケット代込みの総額で、予算を入力してください。",
      );
      return;
    }
    const children = parseNumericText(childrenText) ?? 0;
    setFormError(null);
    generateMutation.mutate({
      ...form,
      adults,
      children,
      budgetJpy: budget,
    });
  };

  // Saving keeps the same parse-at-press rule without the creation
  // checks: an emptied adults field keeps the last saved count
  // rather than writing an impossible 0, an emptied budget saves
  // as 未入力 (null), and emptied children save as 0.
  const handleSave = () => {
    setFormError(null);
    saveMutation.mutate({
      ...form,
      adults: parseNumericText(adultsText) ?? form.adults,
      children: parseNumericText(childrenText) ?? 0,
      budgetJpy: parseNumericText(budgetText),
    });
  };

  const editNumeric = (
    setter: (v: string) => void,
  ): ((e: { target: { value: string } }) => void) => {
    return (e) => {
      dirtyRef.current = true;
      setter(e.target.value);
    };
  };

  const inputCls =
    "w-full min-w-0 max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base";
  const labelCls = "block text-sm font-semibold";
  const hintCls = "mt-1 text-xs text-[var(--dim)]";

  return (
    <form
      className="min-h-0 w-full min-w-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-4 pb-6 pt-3"
      onSubmit={(e: FormEvent) => e.preventDefault()}
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
              aria-checked={form.park === opt.value}
              onClick={() => set("park", opt.value)}
              className={`rounded-[var(--radius)] border px-3 py-2.5 font-display text-base font-bold ${
                form.park === opt.value
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
          {(
            [
              { value: "slow", label: "ゆっくり" },
              { value: "slightly_slow", label: "少しゆっくり" },
              { value: "slightly_fast", label: "少し急いで" },
              { value: "fast", label: "急いで" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={form.walkingSpeed === opt.value}
              onClick={() => set("walkingSpeed", opt.value)}
              className={`rounded-[var(--radius)] border px-2 py-2.5 text-sm font-bold ${
                form.walkingSpeed === opt.value
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)]"
                  : "border-[var(--border)] bg-[var(--surface)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className={hintCls}>
          施設間の移動時間は、この速さと施設間の距離から計算します（直線距離が下限で、距離に応じた迂回と余裕を加えます）。
        </p>
      </fieldset>

      {/* Date / entry / exit row. On phones the three fields STACK,
          each on its own full-width row: native date/time inputs on
          mobile WebKit (the Muse app's iOS webview) refuse to shrink
          below their intrinsic width even with min-width: 0, so in the
          earlier 2-column layout the date cell (and the half-width
          time cells) were still pushed past the screen edge on the
          user's real phone while Chromium rendered them fine. A
          full-width row gives every input the whole content width —
          the most any native input can ask for — and makes all three
          widths uniform. From sm up the three sit side by side in
          equal minmax(0,1fr) tracks. The matching appearance reset for
          phone widths lives in theme.css. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="min-w-0">
          <label htmlFor="visit-date" className={labelCls}>日付</label>
          <input
            id="visit-date"
            type="date"
            className={inputCls}
            value={form.visitDate ?? ""}
            onChange={(e) => set("visitDate", e.target.value || null)}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="entry-time" className={labelCls}>入園時刻</label>
          <TimeSelect
            id="entry-time"
            className={inputCls}
            value={form.entryTime}
            onChange={(v) => set("entryTime", v)}
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
            className={inputCls}
            value={form.exitTime}
            onChange={(v) => set("exitTime", v)}
            startMin={9 * 60}
            endMin={22 * 60 + 30}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="min-w-0">
          <label htmlFor="budget" className={labelCls}>予算（円）</label>
          <input
            id="budget"
            type="text"
            inputMode="numeric"
            placeholder="例：30000"
            className={inputCls}
            value={budgetText}
            onChange={editNumeric(setBudgetText)}
          />
          <p className={hintCls}>チケット代込みの総額で入力してください</p>
        </div>
        <div className="min-w-0">
          <label htmlFor="adults" className={labelCls}>大人（人）</label>
          <input
            id="adults"
            type="text"
            inputMode="numeric"
            className={inputCls}
            value={adultsText}
            onChange={editNumeric(setAdultsText)}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="children" className={labelCls}>子ども（人）</label>
          <input
            id="children"
            type="text"
            inputMode="numeric"
            className={inputCls}
            value={childrenText}
            onChange={editNumeric(setChildrenText)}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="children-ages" className={labelCls}>子どもの年齢・身長</label>
          <input
            id="children-ages"
            type="text"
            placeholder="例：6歳、102cm"
            className={inputCls}
            value={form.childrenAges ?? ""}
            onChange={(e) => set("childrenAges", e.target.value || null)}
          />
        </div>
      </div>

      {/* No 宿泊 field (owner's decision, 2026-11-16): a stay had no
          mechanical effect anywhere — its only coupling was gating
          the 8:45 Happy Entry option, which made the form
          inconsistent (an 8:45 entry the stay did not entitle, or a
          stay that changed nothing). The entry floor is now 8:45
          unconditionally and the stay is gone from the form, the
          plan tab's 条件 panel and new conditions snapshots. The
          conditions.stay_hotel column and old snapshots keep their
          recorded values untouched (history is never rewritten). */}

      <div>
        <label htmlFor="priority" className={labelCls}>重視する点（3プラン共通）</label>
        <textarea
          id="priority"
          rows={4}
          placeholder="例：美女と野獣とプーさんは絶対に乗りたい。子どもがいるので絶叫系は苦手。疲れやすいので、動き回らず休憩多めに"
          className={inputCls}
          value={form.priority ?? ""}
          onChange={(e) => set("priority", e.target.value || null)}
        />
        <p className={hintCls}>
          ここに書いたことは、混雑シナリオで分かれる3プランの全てに共通して反映されます。
        </p>
      </div>

      {formError ?? genError ? (
        <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
          {formError ?? genError}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={generateMutation.isPending}
          onClick={handleGenerate}
          className="rounded-full bg-[var(--accent)] px-5 py-2.5 font-display text-base font-bold text-[var(--accent-text)] disabled:opacity-50"
        >
          {generateMutation.isPending ? "開始しています…" : "この条件で3プランを作成"}
        </button>
        <button
          type="button"
          disabled={saveMutation.isPending}
          onClick={handleSave}
          className="rounded-full bg-[var(--surface-alt)] px-5 py-2.5 text-base font-semibold disabled:opacity-50"
        >
          {saveMutation.isSuccess && !dirtyRef.current ? "保存しました" : "条件を保存"}
        </button>
      </div>

      <p className="text-xs leading-relaxed text-[var(--dim)]">
        プランは作成のたびに公式サイトでその日の情報を確認して作ります（作成には10〜20分ほどかかります）。フォームの項目そのものを増減したいときは、Museのメインチャットで「このアプリに◯◯を追加して」と指示してください。この画面のAIは計画づくり専用です。
      </p>

      <SameDaySearchSection
        conditions={conditions}
        onGenerated={onGenerated}
        prefill={sameDayPrefill}
      />
    </form>
  );
}

