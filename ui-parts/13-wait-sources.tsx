// ------------------------------------------------------- wait-time sources

// Fixed tab (same rank as AIチャット / プラン作成, never deletable): a
// display-only list of the registered wait-time reference sites. There
// is deliberately NO add/edit form here — additions, removals and
// re-searches are instructed to the AI through the bottom form, and the
// AI does the searching, checking and registering.
function WaitSourcesView({
  sources,
  pending,
}: {
  sources: WaitTimeSource[];
  pending: boolean;
}) {
  const parkBadge = (park: WaitTimeSource["park"]): string =>
    park === "land" ? "ランド" : park === "sea" ? "シー" : "両パーク";
  const checkedLabel = (iso: string | null): string => {
    if (!iso) return "最終確認日：未確認";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "最終確認日：未確認";
    return `最終確認日：${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  };
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

      {pending ? (
        <div
          role="status"
          className="mt-4 flex items-center gap-2.5 rounded-2xl border-2 border-[var(--accent)] bg-[var(--surface)] px-4 py-3 shadow-md"
        >
          <span aria-hidden className="flex items-end gap-1">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </span>
          <span className="text-base font-bold">
            AIが参考サイトを更新しています…
          </span>
        </div>
      ) : null}

      {sources.length === 0 ? (
        <p className="mt-5 rounded-[var(--radius)] border border-dashed border-[var(--border)] px-3 py-3 text-sm leading-relaxed text-[var(--dim)]">
          現在、登録されている参考サイトはありません。画面下のフォームから「待ち時間の参考サイトを探して登録して」とAIに指示してください。
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {sources.map((s) => (
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
              <p className="mt-1 text-xs text-[var(--dim)]">
                {checkedLabel(s.lastCheckedAt)}
              </p>
              <p className="mt-0.5 text-xs text-[var(--dim)]">
                取得方法：
                {s.fetchMethod === "script"
                  ? "スクリプトで取得"
                  : s.fetchMethod === "browser"
                    ? "ブラウザ表示で取得"
                    : s.fetchMethod === "failed"
                      ? "前回は取得できませんでした"
                      : "未記録（次回確認します）"}
              </p>
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

