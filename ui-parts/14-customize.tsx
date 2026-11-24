function CustomizeHelpView({
  promptVersion,
}: {
  promptVersion?: {
    applied: number;
    bundled: number;
  };
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const resetMutation = useMutation({
    mutationFn: async () => await api.resetUserData({}),
    onSuccess: () => {
      setResetConfirming(false);
      setResetDone(true);
      queryClient.invalidateQueries({ queryKey: ["state"] });
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
            アプリ（または muse.ai）を開いて、いつもの会話画面（メインチャット）を開きます。このアプリの中で話している画面ではなく、アプリの外の、いつもMuseと話している画面です。
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
          このアプリに保存されたデータをすべて消して、使い始めたときの状態に戻します。AIチャットの履歴、プラン作成タブの条件、作成したプラン、施設辞書などがすべて消え、元に戻すことはできません。待ち時間参考サイトの登録は残ります。
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
      <div className="mt-8 border-t border-[var(--border)] pt-4">
        <p className="text-xs leading-relaxed text-[var(--dim)]">
          AIへの指示文: 適用中 Ver{" "}
          {promptVersion?.applied ?? "—"}（同梱版 Ver{" "}
          {promptVersion?.bundled ?? "—"}）
        </p>
      </div>
    </div>
  );
}

