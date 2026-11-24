function ChatView({
  state,
  onGoToSearch,
  sending,
  pendingText,
  researchPending,
  waitSourcesPending,
  verificationPending,
}: {
  state: State;
  onGoToSearch: () => void;
  // While a send is in flight: the just-sent message (shown immediately so
  // the tab switch reads as "my message went through") and the thinking
  // indicator below it.
  sending: boolean;
  pendingText: string | null;
  // While a fact-check task is reading the official site; its answer is
  // posted into this chat when it finishes.
  researchPending: boolean;
  // While an add/remove/re-search instruction for the wait-time
  // reference sites is being carried out; the result is posted into
  // this chat when it finishes.
  waitSourcesPending: boolean;
  // While a bulk re-verification （一括検証） is running; its result
  // is posted into this chat when it finishes.
  verificationPending: boolean;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [state.messages.length, sending, researchPending, waitSourcesPending, verificationPending]);

  return (
    // overflow-x-hidden + overflow-wrap:anywhere (inherited by every
    // bubble): assistant replies carry long unbroken source URLs, and
    // with only whitespace-pre-wrap those URLs refused to wrap, widened
    // this scroll region to ~615px at phone width and made the whole
    // chat tab scroll sideways. Horizontal scrolling stays confined to
    // the tab strip; tab content never scrolls sideways.
    <div ref={listRef} className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 pb-4 pt-3 [overflow-wrap:anywhere]">
      {/* Guide, always at the top of the chat tab: start from the conditions
          tab, ask this AI anything via the bottom form, and take complaints
          about the app itself to Muse in the main chat. */}
      <div className="rounded-[var(--radius)] bg-[var(--surface-alt)] px-4 py-4">
        <p className="font-display text-base font-bold">
          当日あたふたしないために、前日までに全部決める。
        </p>
        <p className="mt-2 text-sm leading-relaxed">
          ディズニーの複雑なシステムを踏まえた上で、AIが最適なプランを３つ同時に提案します。常に「今のディズニー」に合わせたプランを提案できます。
        </p>
        <ol className="mt-3 space-y-2.5 text-sm leading-relaxed">
          <li>
            <span className="font-semibold">1. まずは「プラン作成」タブから。</span>
            日付・パーク・予算と、3プラン共通の「重視する点」を入力して、「この条件で3プランを作成」を押してください。公式サイトでその日の情報を確認したうえで、その日の混雑予想をもとに混雑シナリオの違う3つのプラン（A＝激混み前提、B＝やや混み前提、C＝思ったより空いてる前提）を作り、新しいタブに表示します。
          </li>
          <li>
            <span className="font-semibold">2. 相談・修正は、画面下のAIフォームから。</span>
            プランのことなら何でも相談できます。「プランBをもっとゆっくり回る感じにしたい」「予算をもう少し抑えたい」といった修正も、ここからどうぞ。
          </li>
          <li>
            <span className="font-semibold">3. これはあなた専用のアプリです。</span>
            アプリ自体を変更する事もできます。機能の追加や修正などなんでもMuseのメインチャットでAIに伝えてください。この画面のAIは計画づくり専用です。
          </li>
        </ol>
        <p className="mt-3 text-sm leading-relaxed">
          あなた好みの旅行計画アプリに育てて、有意義なディズニー旅行を楽しんでください。
        </p>
        <button
          type="button"
          onClick={onGoToSearch}
          className="mt-4 w-full rounded-full bg-[var(--accent)] px-4 py-2.5 text-base font-bold text-[var(--accent-text)]"
        >
          まずはプラン作成
        </button>
      </div>

      {state.messages.length === 0 && !sending && !researchPending && !waitSourcesPending && !verificationPending ? null : (
        <ol className="mt-4 min-w-0 space-y-3">
          {state.messages.map((m) => (
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
          {researchPending && !sending ? (
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
                  公式サイトで確認しています…
                </span>
              </div>
            </li>
          ) : null}
          {waitSourcesPending && !sending ? (
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
                  待ち時間参考サイトを更新しています…
                </span>
              </div>
            </li>
          ) : null}
          {verificationPending && !sending ? (
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
                  プランを検証しています…
                </span>
              </div>
            </li>
          ) : null}
        </ol>
      )}

      {/* Scope notice: footnote pinned to the very bottom of the chat
          tab (after the message list when it overflows). Wording is the
          user's own: the one thing the app cannot do is obtain DPA
          sales status; day-of rescheduling on an explicit instruction
          IS supported. */}
      <p className="mt-auto px-1 pt-6 text-xs leading-relaxed text-[var(--dim)]">
        ※このアプリはDPAの販売状況は取得できません。当日の状況によってその場でリスケジュールする際は「予定していたトイ・ストーリーが取れなくなった。リスケジュールして」などと具体的に指示してください。
      </p>
    </div>
  );
}

// Parses a numeric form field's raw text at submit time (記録AQ):
// the numeric fields of the conditions form and the same-day form
// hold the user's typed STRING while editing — so a field can be
// cleared with backspace and stay empty — and are interpreted as
// numbers only when a button is pressed. Empty (or digit-less)
// text parses to null = 未入力.
function parseNumericText(text: string): number | null {
  const digits = text.replace(/[^0-9]/g, "");
  if (digits === "") return null;
  const n = Number(digits);
  return Number.isNaN(n) ? null : n;
}

