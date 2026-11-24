// ------------------------------------------------------- plan progress

type PlanProgress = PlanSet["planProgress"]["A" | "B" | "C"];

const PROGRESS_LABELS: Record<PlanProgress, string> = {
  waiting: "待機",
  generating: "作成中",
  done: "完了",
  failed: "失敗",
};

// Per-plan progress rows （プランA：作成中／プランB：待機／プランC：待機）.
// Progress is tracked per plan, not per set: 完了 is shown only for a
// plan that has actually been saved, and a plan still being worked on
// never hides the ones already finished.
function PlanProgressList({ planSet }: { planSet: PlanSet }) {
  // A 当日検索 set has exactly one plan by design: its progress list
  // shows plan A only, never B/C rows that will never exist.
  const slots = (
    planSet.setType === "same_day" ? ["A"] : ["A", "B", "C"]
  ) as ("A" | "B" | "C")[];
  return (
    <ul className="mx-auto mt-5 max-w-xs space-y-2 text-left">
      {slots.map((slot) => {
        const st = planSet.planProgress[slot];
        return (
          <li
            key={slot}
            className="flex items-center justify-between rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: PLAN_COLORS[slot] }}
              />
              プラン{slot}
            </span>
            <span
              className={`flex items-center gap-1.5 text-sm font-bold ${
                st === "generating"
                  ? "text-[var(--accent)]"
                  : st === "failed"
                    ? "text-red-700 dark:text-red-300"
                    : "text-[var(--dim)]"
              }`}
            >
              {st === "generating" ? (
                <span aria-hidden className="flex items-end gap-0.5">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </span>
              ) : null}
              {PROGRESS_LABELS[st]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------- generation escape

// The stuck-generation safeguard (owner's design, 2026-11-17): under
// every progress display — and only while a generation or a partial
// operation is in flight — the elapsed time since the run started,
// the fixed note below, and リトライ / キャンセル buttons. The clock
// counts from the start timestamp the SERVER recorded for the run
// (the set's generation start, or the partial operation's start),
// so reloading the page never resets it; the one-second tick only
// re-renders the difference. Both buttons call server actions that
// never involve the possibly-dead generation task itself.
const GENERATION_ESCAPE_NOTE =
  "通常は遅くても20分以内で作成されます。遅すぎる場合はMuseが固まってる可能性があります。その場合、キャンセルかリトライボタンを押してください。";

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${h}時間${m}分${s}秒` : `${m}分${s}秒`;
}

// The once-a-minute report lines (spec §12.13): what the
// generation is doing, one plain-words line per minute, written
// on the server's clock and carried in the state — this list only
// renders them, oldest first, each with its time.
function GenerationReportLines({
  lines,
}: {
  lines: { at: string; text: string }[];
}) {
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-1">
      {lines.map((l, i) => {
        const d = new Date(l.at);
        const clock = Number.isNaN(d.getTime())
          ? ""
          : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        return (
          <li key={i} className="flex gap-2 text-sm leading-relaxed">
            {clock ? (
              <span className="shrink-0 tabular-nums text-[var(--dim)]">
                {clock}
              </span>
            ) : null}
            <span>{l.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

function GenerationEscapeBlock({
  planSetId,
  startedAt,
  centered = false,
  reportLines,
}: {
  planSetId: number;
  startedAt: string | null;
  centered?: boolean;
  reportLines?: { at: string; text: string }[];
}) {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const retryMutation = useMutation({
    mutationFn: async () => await api.retryGeneration({ planSetId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["state"] }),
  });
  const cancelMutation = useMutation({
    mutationFn: async () => await api.cancelGeneration({ planSetId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["state"] }),
  });
  const busy = retryMutation.isPending || cancelMutation.isPending;
  const error =
    retryMutation.data && !retryMutation.data.ok
      ? retryMutation.data.error
      : cancelMutation.data && !cancelMutation.data.ok
        ? cancelMutation.data.error
        : retryMutation.isError || cancelMutation.isError
          ? "操作できませんでした。少し待ってもう一度お試しください。"
          : null;
  const startMs = startedAt ? new Date(startedAt).getTime() : null;
  return (
    <div
      className={
        centered
          ? "mx-auto mt-6 max-w-md space-y-2.5 text-left"
          : "mt-3 space-y-2.5 text-left"
      }
    >
      {reportLines && reportLines.length > 0 ? (
        <GenerationReportLines lines={reportLines} />
      ) : null}
      {startMs != null && !Number.isNaN(startMs) ? (
        <p className="text-sm font-semibold">
          経過時間：{formatElapsed(now - startMs)}
        </p>
      ) : null}
      <p className="text-sm leading-relaxed text-[var(--dim)]">
        {GENERATION_ESCAPE_NOTE}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => retryMutation.mutate()}
          disabled={busy}
          className="rounded-full bg-[var(--accent)] px-5 py-1.5 text-sm font-bold text-[var(--accent-text)] disabled:opacity-50"
        >
          リトライ
        </button>
        <button
          type="button"
          onClick={() => cancelMutation.mutate()}
          disabled={busy}
          className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-1.5 text-sm font-bold text-red-700 disabled:opacity-50 dark:text-red-300"
        >
          キャンセル
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// A failed plan set's リトライ button: the set stands at 失敗
// (never stuck at 作成中 — that is the state the task manager
// leaves when a generation's attempts ran out) and
// retryGeneration re-runs the whole generation on the SAME set
// from its recorded start inputs. Shown on the failed set's own
// tab, the failure surface for plan creation / same-day search.
function FailedSetRetryBlock({ planSetId }: { planSetId: number }) {
  const queryClient = useQueryClient();
  const retryMutation = useMutation({
    mutationFn: async () => await api.retryGeneration({ planSetId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["state"] }),
  });
  const error =
    retryMutation.data && !retryMutation.data.ok
      ? retryMutation.data.error
      : retryMutation.isError
        ? "操作できませんでした。少し待ってもう一度お試しください。"
        : null;
  return (
    <div className="mt-4 space-y-2.5">
      <button
        type="button"
        onClick={() => retryMutation.mutate()}
        disabled={retryMutation.isPending}
        className="rounded-full bg-[var(--accent)] px-5 py-1.5 text-sm font-bold text-[var(--accent-text)] disabled:opacity-50"
      >
        リトライ
      </button>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// A partial operation （部分差し替え / 当日リスケ） the task
// manager ended after exhausting its attempts: the slot stands
// at 失敗 with its request still recorded and the original plan
// untouched. リトライ re-runs the recorded request on the same
// slot; キャンセル stands the slot back down to the original.
function PartialOpFailedBlock({ planSetId }: { planSetId: number }) {
  const queryClient = useQueryClient();
  const retryMutation = useMutation({
    mutationFn: async () => await api.retryGeneration({ planSetId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["state"] }),
  });
  const cancelMutation = useMutation({
    mutationFn: async () => await api.cancelGeneration({ planSetId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["state"] }),
  });
  const busy = retryMutation.isPending || cancelMutation.isPending;
  const error =
    retryMutation.data && !retryMutation.data.ok
      ? retryMutation.data.error
      : cancelMutation.data && !cancelMutation.data.ok
        ? cancelMutation.data.error
        : retryMutation.isError || cancelMutation.isError
          ? "操作できませんでした。少し待ってもう一度お試しください。"
          : null;
  return (
    <div className="mt-2.5 space-y-2.5">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => retryMutation.mutate()}
          disabled={busy}
          className="rounded-full bg-[var(--accent)] px-5 py-1.5 text-sm font-bold text-[var(--accent-text)] disabled:opacity-50"
        >
          リトライ
        </button>
        <button
          type="button"
          onClick={() => cancelMutation.mutate()}
          disabled={busy}
          className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-1.5 text-sm font-bold text-red-700 disabled:opacity-50 dark:text-red-300"
        >
          キャンセル
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm font-semibold text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

