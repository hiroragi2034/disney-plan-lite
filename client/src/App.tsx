import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { api, type ApiResponse } from "./api";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";
import { PlanSetView } from "./PlanSetView";

const FIELDS = actionFields<typeof Actions>();

type State = ApiResponse<typeof api, "getState">;
type Condition = NonNullable<State["savedCondition"]>;
type Tab = { type: "chat" } | { type: "form" } | { type: "sites" } | { type: "more" } | { type: "set"; id: number };

const PRIORITY_PLACEHOLDER = `例：
・美女と野獣は絶対に乗りたい。できればDPAで
・プーさんは子どもと一緒に。絶叫系は全員苦手なので入れない
・昼食は座れる店で12時台に。子どもが昼寝しそうなら、その間に大人は交代で1つ乗る
・夕食は17時台に早めに済ませたい
・帰る前に30分、お土産を見る時間を残して`;

function timeOptions(from: string, to: string): string[] {
  const out: string[] = [];
  const [fh = 0, fm = 0] = from.split(":").map(Number);
  const [th = 0, tm = 0] = to.split(":").map(Number);
  let cur = fh * 60 + fm;
  const end = th * 60 + tm;
  while (cur <= end) {
    out.push(`${String(Math.floor(cur / 60)).padStart(2, "0")}:${String(cur % 60).padStart(2, "0")}`);
    cur += 15;
  }
  return out;
}
const ENTRY_OPTIONS = timeOptions("08:45", "21:00");
const EXIT_OPTIONS = timeOptions("09:00", "22:30");

function withExtra(options: string[], value: string): string[] {
  return value && !options.includes(value) ? [...options, value].sort() : options;
}

function ChatView({ messages, sending, onGoForm }: { messages: State["messages"]; sending: boolean; onGoForm: () => void }) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, sending]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <h1 className="text-2xl font-bold leading-snug">当日あたふたしないために、前日までに全部決める。</h1>
      <p className="mt-2 text-base leading-relaxed">
        ディズニーの複雑なシステムを踏まえた上で、AIが最適なプランを３つ同時に提案します。常に『今のディズニー』に合わせたプランを提案できます。
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-base leading-relaxed">
        <li>まずは「プラン作成」タブから条件を入れて「この条件で3プランを作成」を押してください。</li>
        <li>この画面（AIチャット）では、プランの相談・作り直し・制度や施設の調べ物ができます。</li>
        <li>これはあなた専用のアプリです。アプリ自体を変更する事もできます。機能の追加や修正などなんでもMuseのメインチャットでAIに伝えてください。この画面のAIは計画づくり専用です。</li>
      </ol>
      <button type="button" onClick={onGoForm} className="mt-4 w-full rounded-lg bg-[var(--accent)] px-4 py-3 text-base font-bold text-white">
        まずはプラン作成
      </button>
      <p className="mt-3 text-sm text-[var(--dim)]">※このアプリはDPAの販売状況は取得できません。</p>
      <p className="mt-1 text-sm text-[var(--dim)]">足りない機能は、あなたのMuseに追加してもらえます。</p>

      <div className="mt-6 space-y-3 pb-2">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-base leading-relaxed ${
                m.role === "user" ? "bg-[var(--accent)] text-white" : "bg-[var(--surface)]"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {sending && <p className="text-sm text-[var(--dim)]">返信を生成中です…</p>}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function ConditionForm({ saved, onStarted }: { saved: Condition | null; onStarted: (setId: number) => void }) {
  const queryClient = useQueryClient();
  const [park, setPark] = useState<"sea" | "land">(saved?.park ?? "sea");
  const [date, setDate] = useState(saved?.visitDate ?? "");
  const [entryTime, setEntryTime] = useState(saved?.entryTime ?? "");
  const [exitTime, setExitTime] = useState(saved?.exitTime ?? "");
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
      setEntryTime(saved.entryTime ?? "");
      setExitTime(saved.exitTime ?? "");
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
      entryTime: entryTime === "" ? null : entryTime,
      exitTime: exitTime === "" ? null : exitTime,
      budget: Math.floor(budgetNum),
      adults: Math.floor(adultsNum),
      children: childList,
      priority,
      walkSpeed,
    });
  };

  const nChild = Math.max(0, Math.min(20, Number(childCount) || 0));
  const inputCls = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base";
  const labelCls = "block text-sm font-semibold";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <form onSubmit={submit} className="space-y-5 pb-8">
        <p className="rounded-lg bg-[var(--surface)] px-3 py-2.5 text-sm leading-relaxed">
          「重視する点」は1つの欄にまとめ、3プラン全てに効きます。3プランは混雑度に応じて作り分けます（プランA＝激混み前提、プランB＝やや混み前提（予想どおり）、プランC＝思ったより空いてる前提）。混雑の判断はアプリ側が行い、利用者は選びません。
        </p>
        <div>
          <span className={labelCls}>パーク</span>
          <div className="mt-1.5 flex gap-2" role="radiogroup" aria-label="パーク">
            {(
              [
                ["sea", "東京ディズニーシー"],
                ["land", "東京ディズニーランド"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={park === v}
                onClick={() => setPark(v)}
                className={`flex-1 rounded-lg px-3 py-2.5 text-base ${park === v ? "bg-[var(--accent)] font-semibold text-white" : "bg-[var(--surface)]"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="visit-date" className={labelCls}>日付</label>
            <input {...FIELDS.startFromForm.condition.visitDate} id="visit-date" type="date" aria-label="日付" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} mt-1.5`} required />
          </div>
          <div>
            <label htmlFor="entry-time" className={labelCls}>入園時刻</label>
            <select {...FIELDS.startFromForm.condition.entryTime} id="entry-time" aria-label="入園時刻" value={entryTime} onChange={(e) => setEntryTime(e.target.value)} className={`${inputCls} mt-1.5`}>
              <option value="">未定</option>
              {withExtra(ENTRY_OPTIONS, entryTime).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">入園できる最速は8:45（ハッピーエントリー）です。それより前の時刻は選べません。</p>
          </div>
          <div>
            <label htmlFor="exit-time" className={labelCls}>退園時刻</label>
            <select {...FIELDS.startFromForm.condition.exitTime} id="exit-time" aria-label="退園時刻" value={exitTime} onChange={(e) => setExitTime(e.target.value)} className={`${inputCls} mt-1.5`}>
              <option value="">未定</option>
              {withExtra(EXIT_OPTIONS, exitTime).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="budget" className={labelCls}>予算（円・チケット代込みの総額）</label>
            <input {...FIELDS.startFromForm.condition.budget} id="budget" type="text" aria-label="予算（円・チケット代込みの総額）" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value)} className={`${inputCls} mt-1.5`} placeholder="例：50000" />
          </div>
          <div>
            <label htmlFor="adults" className={labelCls}>大人人数</label>
            <input {...FIELDS.startFromForm.condition.adults} id="adults" type="text" aria-label="大人人数" inputMode="numeric" value={adults} onChange={(e) => setAdults(e.target.value)} className={`${inputCls} mt-1.5`} placeholder="例：2" />
          </div>
          <div>
            <label htmlFor="child-count" className={labelCls}>子ども人数</label>
            <input id="child-count" type="text" aria-label="子ども人数" inputMode="numeric" value={childCount} onChange={(e) => setChildCount(e.target.value)} className={`${inputCls} mt-1.5`} />
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
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            placeholder={PRIORITY_PLACEHOLDER}
            className={`${inputCls} mt-1.5 leading-relaxed`}
          />
          <p className="mt-1 text-sm text-[var(--dim)]">ここに書いたことは、混雑シナリオで分かれる3プランの全てに共通して反映されます。</p>
        </div>
        <div>
          <span className={labelCls}>歩く速さ</span>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="歩く速さ">
            {(
              [
                [55, "ゆっくり"],
                [70, "少しゆっくり"],
                [85, "少し急いで"],
                [100, "急いで"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={walkSpeed === v}
                onClick={() => setWalkSpeed(v)}
                className={`rounded-lg px-3 py-2.5 text-base ${walkSpeed === v ? "bg-[var(--accent)] font-semibold text-white" : "bg-[var(--surface)]"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p>}
        <button type="submit" disabled={start.isPending} className="w-full rounded-lg bg-[var(--accent)] px-4 py-3.5 text-base font-bold text-white">
          {start.isPending ? "開始しています…" : "この条件で3プランを作成"}
        </button>
      </form>
    </div>
  );
}

function SitesView({ sites }: { sites: State["waitSites"] }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <p className="text-sm leading-relaxed text-[var(--dim)]">
        推定待ち時間と混雑予想の材料として使う参考サイトの一覧です。参考サイトの追加・削除・再検索は、画面下のフォームからAIに指示してください。
      </p>
      <ul className="mt-4 space-y-3 pb-6">
        {sites.map((s) => (
          <li key={s.id} className="rounded-lg bg-[var(--surface)] px-3.5 py-3">
            <a href={s.url} target="_blank" rel="noopener" className="text-base font-semibold text-[var(--accent)] underline">
              {s.name}
            </a>
            <p className="mt-0.5 text-sm text-[var(--dim)]">対象：{s.park === "sea" ? "シー" : s.park === "land" ? "ランド" : "両パーク"}</p>
            <p className="mt-1 text-sm leading-relaxed">{s.provides}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MoreView({ counts }: { counts: State["counts"] }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const reset = useMutation({
    mutationFn: async () => await api.resetAllData({}),
    onSuccess: () => {
      setConfirming(false);
      queryClient.invalidateQueries();
    },
  });
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <p className="text-base leading-relaxed">
        この画面のAIは計画づくり専用です。アプリ自体の変更（機能の追加や修正など）は、Museのメインチャットで伝えてください。
      </p>
      <p className="mt-3 text-base leading-relaxed">足りない機能は、あなたのMuseに追加してもらえます。</p>
      <div className="mt-8 border-t border-[var(--border)] pt-4">
        <h2 className="font-semibold">利用者データの消去</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          会話・保存済み条件・プランセット・ファクト・取得スナップショットを全て消して初期状態に戻します。施設辞書・エリア間移動時間・待ち時間参考サイトの初期データは残ります。
        </p>
        <p className="mt-2 text-sm text-[var(--dim)]">
          現在の件数：固定タブ {counts.fixedTabs}枚／プランセット {counts.planSetTabs}枚／会話 {counts.messages}件／施設辞書 {counts.facilities}件／エリア間移動時間 {counts.areaMoves}件／参考サイト {counts.waitSites}件
        </p>
        {confirming ? (
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => reset.mutate()} disabled={reset.isPending} className="flex-1 rounded-lg bg-[#e4572e] px-4 py-3 font-semibold text-white">
              本当に全て消す
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="flex-1 rounded-lg bg-[var(--surface)] px-4 py-3 font-semibold">
              やめる
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="mt-3 w-full rounded-lg bg-[var(--surface)] px-4 py-3 font-semibold">
            全ての利用者データを消して初期状態に戻す
          </button>
        )}
      </div>
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>({ type: "chat" });
  const [draft, setDraft] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const composingRef = useRef(false);

  const state = useQuery({
    queryKey: ["state"],
    queryFn: () => api.getState({}),
    refetchInterval: (q) => (q.state.data?.planSets.some((s) => s.status === "creating") ? 20000 : false),
  });

  const send = useMutation({
    mutationFn: async (payload: { text: string; openTab: { type: string; setId: number | null; slot: string | null } }) =>
      await api.sendChatMessage(payload),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: () => {
      // 送信に失敗したら下書きを復元する
      if (lastSentRef.current) setDraft(lastSentRef.current);
    },
  });
  const lastSentRef = useRef("");

  const data = state.data;
  const activeSet = tab.type === "set" ? data?.planSets.find((s) => s.id === tab.id) : undefined;

  const doSend = () => {
    const text = draft.trim();
    if (!text || send.isPending) return;
    lastSentRef.current = draft;
    setDraft("");
    send.mutate({
      text,
      openTab: {
        type: tab.type,
        setId: tab.type === "set" ? tab.id : null,
        slot: tab.type === "set" ? selectedSlot : null,
      },
    });
  };
  const onFormKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !composingRef.current && !(e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) {
      e.preventDefault();
      doSend();
    }
  };

  const tabBtn = (active: boolean) =>
    `shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-sm ${active ? "bg-[var(--accent)] font-semibold text-white" : "bg-[var(--surface)]"}`;

  // 広い画面で地図が右列になるプランタブでは、レイアウト全体を左右いっぱいに広げる
  const wide = tab.type === "set";

  return (
    <div className="flex h-dvh flex-col bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <nav aria-label="タブ" className="flex gap-1.5 overflow-x-auto px-3 pb-2 pt-safe">
        <button type="button" className={tabBtn(tab.type === "chat")} onClick={() => setTab({ type: "chat" })}>チャット</button>
        <button type="button" className={tabBtn(tab.type === "form")} onClick={() => setTab({ type: "form" })}>プラン作成</button>
        <button type="button" className={tabBtn(tab.type === "sites")} onClick={() => setTab({ type: "sites" })}>待ち時間参考サイト</button>
        <button type="button" className={tabBtn(tab.type === "more")} onClick={() => setTab({ type: "more" })}>もっとこうして！</button>
        {(data?.planSets ?? []).map((s) => (
          <button key={s.id} type="button" className={tabBtn(tab.type === "set" && tab.id === s.id)} onClick={() => setTab({ type: "set", id: s.id })}>
            {s.title}
            {s.status === "creating" ? "（作成中）" : s.status === "failed" ? "（失敗）" : ""}
          </button>
        ))}
      </nav>

      <main className={`flex min-h-0 flex-1 flex-col ${wide ? "w-full" : "mx-auto w-full max-w-3xl lg:max-w-5xl"}`}>
        {state.isPending && <p className="px-4 py-6 text-sm text-[var(--dim)]">読み込み中…</p>}
        {state.error && <p className="px-4 py-6 text-sm">読み込みに失敗しました。再度お試しください。</p>}
        {data && tab.type === "chat" && <ChatView messages={data.messages} sending={send.isPending} onGoForm={() => setTab({ type: "form" })} />}
        {data && tab.type === "form" && (
          <ConditionForm saved={data.savedCondition} onStarted={(setId) => setTab({ type: "set", id: setId })} />
        )}
        {data && tab.type === "sites" && <SitesView sites={data.waitSites} />}
        {data && tab.type === "more" && <MoreView counts={data.counts} />}
        {data && tab.type === "set" && activeSet && (
          <PlanSetView
            key={activeSet.id}
            setId={activeSet.id}
            startedAt={activeSet.startedAt}
            progress={activeSet.progress}
            onDeleted={() => setTab({ type: "chat" })}
            onSlotChange={setSelectedSlot}
          />
        )}
        {data && tab.type === "set" && !activeSet && <p className="px-4 py-6 text-sm text-[var(--dim)]">このプランセットは削除されました。</p>}
      </main>

      <form
        className="border-t border-[var(--border)] bg-[var(--surface)] px-3 pb-safe pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          doSend();
        }}
      >
        <div className={`flex items-end gap-2 ${wide ? "w-full" : "mx-auto w-full max-w-3xl lg:max-w-5xl"}`}>
          <label htmlFor="ai-message" className="sr-only">AIへの指示</label>
          <textarea
            {...FIELDS.sendChatMessage.text}
            id="ai-message"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onFormKeyDown}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            placeholder="プランの相談・作り直し・調べ物など、AIへの指示を入力"
            className="min-h-11 flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-base leading-relaxed"
          />
          <button type="submit" disabled={send.isPending || !draft.trim()} className="min-h-11 shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">
            送信
          </button>
        </div>
      </form>
    </div>
  );
}
