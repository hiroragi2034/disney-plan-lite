import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import "./hatch-maps.js";
import "./hatch-maps.css";
import { mountPlaceListMap } from "./map_helpers.mjs";

type SetDetail = NonNullable<ApiResponse<typeof api, "getPlanSet">["set"]>;
type Plan = SetDetail["plans"][number];
type Row = Plan["rows"][number];

const SLOT_LABEL: Record<string, string> = { A: "A 激混み", B: "B 混雑", C: "C 楽" };
const KIND_LABEL: Record<string, string> = {
  attraction: "アトラクション",
  show: "ショー",
  parade: "パレード",
  restaurant: "レストラン",
  break: "休憩",
  move: "移動",
  other: "その他",
  purchase: "DPA購入",
  first10: "入園後の最初の10分",
};

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}分${String(s % 60).padStart(2, "0")}秒`;
}

function MapBand({ rows, detailRef }: { rows: Row[]; detailRef: React.RefObject<HTMLDivElement | null> }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const pinned = rows.filter((r) => r.lat != null && r.lng != null);
  const key = pinned.map((r) => r.id).join(",");

  useEffect(() => {
    setUnavailable(false);
    const el = containerRef.current;
    if (!el || pinned.length === 0) return;
    const rowEls = pinned
      .map((r) => detailRef.current?.querySelector<HTMLElement>(`[data-row-id="${r.id}"]`) ?? null)
      .filter((x): x is HTMLElement => x != null);
    if (rowEls.length !== pinned.length) return;
    const map = mountPlaceListMap(
      el,
      {
        places: pinned.map((r) => ({ label: r.facilityName, lat: r.lat as number, lng: r.lng as number })),
        rows: rowEls,
        baseStyle: "light",
        selectedClass: "map-selected",
      },
      () => setUnavailable(true),
    );
    return () => {
      if (map) {
        try {
          map.selectPlace(null);
        } catch {
          /* noop */
        }
      }
      el.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (pinned.length === 0) return null;
  if (unavailable) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--surface)] px-4 text-center text-sm text-[var(--dim)]">
        地図を表示できませんでした。スケジュールの行から場所をご確認ください。
      </div>
    );
  }
  return <div ref={containerRef} className="h-full w-full" aria-label="プランの地図" />;
}

function RowItem({ row, pinNumber }: { row: Row; pinNumber: number | null }) {
  const [showUncertain, setShowUncertain] = useState(false);
  if (row.kind === "move") {
    return (
      <div data-row-id={row.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--dim)]">
        <span className="w-12 shrink-0 tabular-nums">{row.startTime ?? ""}</span>
        <span>
          移動 約{row.moveMinutes ?? "―"}分
          {row.walkM != null ? `（歩行距離 約${row.walkM.toLocaleString()}m）` : ""}
          {row.note ? `　${row.note}` : ""}
        </span>
      </div>
    );
  }
  if (row.kind === "first10") {
    return (
      <div data-row-id={row.id} className="mx-3 my-2 rounded-lg border border-[var(--accent)] bg-[var(--surface)] px-3 py-2">
        <p className="text-sm font-semibold text-[var(--accent)]">入園後の最初の10分</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{row.note}</p>
      </div>
    );
  }
  const isFacility = ["attraction", "show", "parade", "restaurant"].includes(row.kind);
  return (
    <div data-row-id={row.id} className="flex items-start gap-2 px-3 py-2">
      <span className="w-12 shrink-0 pt-0.5 text-sm font-medium tabular-nums">{row.startTime ?? "--:--"}</span>
      {pinNumber != null ? (
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-white">
          {pinNumber}
        </span>
      ) : (
        <span className="w-6 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-base leading-snug">
          {row.facilityName || row.note || KIND_LABEL[row.kind]}
          <span className="ml-2 align-middle text-xs text-[var(--dim)]">{KIND_LABEL[row.kind]}</span>
        </p>
        {row.kind === "purchase" && (
          <p className="mt-0.5 text-sm text-[var(--dim)]">
            購入時刻 {row.purchaseTime ?? "―"}
            {row.price != null && row.targetCount != null ? `／${row.price.toLocaleString()}円 × ${row.targetCount}人` : ""}
          </p>
        )}
        {row.note && row.facilityName && <p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--dim)]">{row.note}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {isFacility && row.officialUrl && (
            <a href={row.officialUrl} target="_blank" rel="noopener" className="inline-flex min-h-8 items-center text-sm font-medium text-[var(--accent)] underline">
              公式ページ
            </a>
          )}
          {row.uncertain && (
            <button
              type="button"
              aria-label={`未確定の理由を見る: ${row.facilityName}`}
              onClick={() => setShowUncertain((v) => !v)}
              className="inline-flex min-h-8 items-center rounded-full bg-amber-100 px-2 text-xs font-medium text-amber-900"
            >
              未確定（{row.uncertainReason ?? "理由"}）
            </button>
          )}
        </div>
        {showUncertain && row.uncertainReason && (
          <p className="mt-1 text-sm text-amber-900">未確定：{row.uncertainReason}。公式の情報がまだ確認できていない項目です。</p>
        )}
      </div>
      {row.kind === "attraction" && row.waitMinutes != null && (
        <span
          className={`shrink-0 pt-0.5 text-right tabular-nums ${
            row.waitMinutes >= 60 ? "text-xl font-bold text-[#e4572e]" : "text-lg font-semibold"
          }`}
          aria-label={`推定待ち時間 ${row.waitMinutes}分`}
        >
          {row.waitMinutes}
          <span className="text-xs font-normal">分</span>
        </span>
      )}
      {row.kind === "show" && row.waitMinutes != null && (
        <span className="shrink-0 pt-0.5 text-right text-base font-medium tabular-nums" aria-label={`推定待ち時間 ${row.waitMinutes}分`}>
          {row.waitMinutes}
          <span className="text-xs font-normal">分</span>
        </span>
      )}
    </div>
  );
}

function PlanDetail({ set, plan }: { set: SetDetail; plan: Plan }) {
  const [sub, setSub] = useState<"schedule" | "explain" | "congestion">("schedule");
  const [mapVisible, setMapVisible] = useState(true);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const pinnedIds = plan.rows.filter((r) => r.lat != null && r.lng != null).map((r) => r.id);
  const bd = plan.breakdown;

  const detail = (
    <div ref={detailRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex gap-1 px-3 pt-3" role="tablist" aria-label="プランの詳細">
        <button type="button" role="tab" aria-selected={sub === "schedule"} onClick={() => setSub("schedule")} className={`rounded-full px-3 py-1.5 text-sm ${sub === "schedule" ? "bg-[var(--accent)] font-semibold text-white" : "bg-[var(--surface)]"}`}>
          スケジュール
        </button>
        <button type="button" role="tab" aria-selected={sub === "explain"} onClick={() => setSub("explain")} className={`rounded-full px-3 py-1.5 text-sm ${sub === "explain" ? "bg-[var(--accent)] font-semibold text-white" : "bg-[var(--surface)]"}`}>
          プランの説明
        </button>
        {set.congestion && (
          <button type="button" role="tab" aria-selected={sub === "congestion"} onClick={() => setSub("congestion")} className={`rounded-full px-3 py-1.5 text-sm ${sub === "congestion" ? "bg-[var(--accent)] font-semibold text-white" : "bg-[var(--surface)]"}`}>
            混雑予想
          </button>
        )}
      </div>

      {sub === "schedule" && (
        <div>
          <div className="px-3 pt-3">
            <h3 className="text-lg font-bold leading-snug">{plan.title}</h3>
            <p className="mt-1 text-sm text-[var(--dim)]">{plan.scenario}</p>
            <div className="mt-2 rounded-lg bg-[var(--surface)] px-3 py-2">
              <p className="text-base">
                概算費用 合計 <span className="text-xl font-bold tabular-nums">{plan.total.toLocaleString()}円</span>
              </p>
              <ul className="mt-1 space-y-0.5 text-sm text-[var(--dim)]">
                <li>チケット：{bd.ticket.toLocaleString()}円</li>
                <li>DPA：{bd.dpa.toLocaleString()}円{bd.dpaDetail ? `（${bd.dpaDetail}）` : ""}</li>
                <li>食事：{bd.food.toLocaleString()}円</li>
                <li>その他：{bd.other.toLocaleString()}円</li>
                <li>移動時間の合計：約{plan.moveTotal}分／歩行距離の概算：約{plan.walkTotal.toLocaleString()}m</li>
              </ul>
            </div>
          </div>
          <div className="divide-y divide-[var(--border)] pb-6">
            {plan.rows.map((r) => (
              <RowItem key={r.id} row={r} pinNumber={pinnedIds.includes(r.id) ? pinnedIds.indexOf(r.id) + 1 : null} />
            ))}
          </div>
        </div>
      )}

      {sub === "explain" && (
        <div className="space-y-4 px-3 py-3 pb-8">
          <section>
            <h4 className="font-semibold">要約</h4>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{plan.summary}</p>
          </section>
          <section>
            <h4 className="font-semibold">混雑シナリオ前提</h4>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{plan.scenario}</p>
          </section>
          {plan.budgetDisclosure && (
            <section>
              <h4 className="font-semibold">予算について</h4>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{plan.budgetDisclosure}</p>
            </section>
          )}
          {plan.droppedRequests.length > 0 && (
            <section>
              <h4 className="font-semibold">取り込めなかった要求</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
                {plan.droppedRequests.map((d, i) => (
                  <li key={i}>
                    {d.request}：{d.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {set.congestion && (
            <section>
              <h4 className="font-semibold">推定の材料</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
                {set.congestion.materials.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </section>
          )}
          {set.verification && <VerificationRecord raw={set.verification} />}
        </div>
      )}

      {sub === "congestion" && set.congestion && (
        <div className="px-3 py-3 pb-8">
          <p className="text-lg font-bold">混雑予想：{set.congestion.level}／5</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{set.congestion.basis}</p>
          <h4 className="mt-4 font-semibold">使った材料</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {set.congestion.materials.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pt-2">
        <button
          type="button"
          aria-label={mapVisible ? "地図を非表示" : "地図を表示"}
          onClick={() => setMapVisible((v) => !v)}
          className="rounded-full bg-[var(--surface)] px-3 py-1.5 text-sm font-medium"
        >
          {mapVisible ? "地図を非表示" : "地図を表示"}
        </button>
        {set.congestion && <span className="text-sm text-[var(--dim)]">混雑予想：{set.congestion.level}／5</span>}
      </div>
      {mapVisible ? (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="order-1 h-[33dvh] shrink-0 px-3 pt-2 lg:order-2 lg:h-auto lg:min-h-0 lg:w-[42%] lg:shrink lg:px-0 lg:pt-0 lg:pr-3">
            <div className="h-full overflow-hidden rounded-lg border border-[var(--border)]">
              <MapBand rows={plan.rows} detailRef={detailRef} />
            </div>
          </div>
          <div className="order-2 flex min-h-0 flex-1 flex-col lg:order-1">{detail}</div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">{detail}</div>
      )}
    </div>
  );
}

function VerificationRecord({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false);
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  const unconfirmed = parsed && Array.isArray(parsed["unconfirmed"]) ? (parsed["unconfirmed"] as string[]) : [];
  return (
    <section>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="font-semibold text-[var(--accent)]">
        検証の記録{open ? "（閉じる）" : "（開く）"}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-sm leading-relaxed">
          {unconfirmed.length > 0 && (
            <div>
              <p className="font-medium">未確認リスト</p>
              <ul className="list-disc pl-5">
                {unconfirmed.map((u, i) => (
                  <li key={i}>未確認：{u}</li>
                ))}
              </ul>
            </div>
          )}
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-[var(--surface)] p-2 text-xs">{JSON.stringify(parsed, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}

function CreatingView({ setId, startedAt, progress }: { setId: number; startedAt: number | null; progress: { at: number; text: string }[] }) {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const retry = useMutation({
    mutationFn: async () => await api.retrySet({ setId }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const cancel = useMutation({
    mutationFn: async () => await api.cancelSet({ setId }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <p className="text-lg font-bold">作成中です</p>
      <p className="mt-1 text-sm text-[var(--dim)]">
        経過時間：<span className="tabular-nums">{startedAt ? fmtElapsed(now - startedAt) : "―"}</span>
      </p>
      <div className="mt-3 space-y-1.5">
        {progress.map((l, i) => (
          <p key={i} className="text-sm leading-relaxed">
            <span className="mr-2 text-xs text-[var(--dim)] tabular-nums">{new Date(l.at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</span>
            {l.text}
          </p>
        ))}
      </div>
      <p className="mt-4 rounded-lg bg-[var(--surface)] px-3 py-2 text-sm leading-relaxed">
        通常は遅くても20分以内で作成されます。遅すぎる場合はMuseが固まってる可能性があります。その場合、キャンセルかリトライボタンを押してください。
      </p>
      <div className="mt-4 flex gap-2 pb-8">
        <button type="button" onClick={() => retry.mutate()} disabled={retry.isPending} className="flex-1 rounded-lg bg-[var(--accent)] px-4 py-3 font-semibold text-white">
          リトライ
        </button>
        <button type="button" onClick={() => cancel.mutate()} disabled={cancel.isPending} className="flex-1 rounded-lg bg-[var(--surface)] px-4 py-3 font-semibold">
          キャンセル
        </button>
      </div>
    </div>
  );
}

export function PlanSetView({
  setId,
  onDeleted,
  startedAt,
  progress,
  onSlotChange,
}: {
  setId: number;
  onDeleted: () => void;
  startedAt: number | null;
  progress: { at: number; text: string }[];
  onSlotChange?: (slot: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"condition" | "A" | "B" | "C">("A");
  useEffect(() => {
    onSlotChange?.(view === "condition" ? null : view);
  }, [view, onSlotChange]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const detail = useQuery({
    queryKey: ["planSet", setId],
    queryFn: () => api.getPlanSet({ setId }),
    refetchInterval: (q) => (q.state.data?.set?.status === "creating" ? 15000 : false),
  });
  const del = useMutation({
    mutationFn: async () => await api.deletePlanSet({ setId }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      onDeleted();
    },
  });
  const retry = useMutation({
    mutationFn: async () => await api.retrySet({ setId }),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  if (detail.isPending) return <p className="px-4 py-6 text-sm text-[var(--dim)]">読み込み中…</p>;
  if (detail.error || !detail.data?.set) return <p className="px-4 py-6 text-sm">プランセットを読み込めませんでした。</p>;
  const set = detail.data.set;
  const cond = set.condition;
  const selectedPlan = set.plans.find((p) => p.slot === view);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pt-2" role="tablist" aria-label="プランセットの切替">
        {(["condition", "A", "B", "C"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`rounded-full px-3 py-2 text-sm ${view === v ? "bg-[var(--accent)] font-semibold text-white" : "bg-[var(--surface)]"}`}
          >
            {v === "condition" ? "条件" : SLOT_LABEL[v]}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          {set.isRebuild && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">作り直し版</span>}
          {confirmDelete ? (
            <>
              <button type="button" onClick={() => del.mutate()} className="rounded-full bg-[#e4572e] px-3 py-2 text-sm font-semibold text-white">
                本当に削除
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-full bg-[var(--surface)] px-3 py-2 text-sm">
                やめる
              </button>
            </>
          ) : (
            <button type="button" aria-label="このプランセットを削除" onClick={() => setConfirmDelete(true)} className="rounded-full bg-[var(--surface)] px-3 py-2 text-sm">
              削除
            </button>
          )}
        </span>
      </div>
      <h2 className="px-4 pt-2 text-base font-bold">
        {set.title}
        {set.status === "creating" ? "（作成中）" : set.status === "failed" ? "（失敗）" : ""}
      </h2>

      {view === "condition" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <dl className="space-y-2 text-sm leading-relaxed">
            <div><dt className="font-semibold">来園日</dt><dd>{cond.visitDate}</dd></div>
            <div><dt className="font-semibold">パーク</dt><dd>{cond.park === "sea" ? "東京ディズニーシー" : "東京ディズニーランド"}</dd></div>
            <div><dt className="font-semibold">入園時刻</dt><dd>{cond.entryTime ?? "未定"}</dd></div>
            <div><dt className="font-semibold">退園時刻</dt><dd>{cond.exitTime ?? "未定"}</dd></div>
            <div><dt className="font-semibold">予算</dt><dd>{cond.budget.toLocaleString()}円（チケット代込みの総額）</dd></div>
            <div><dt className="font-semibold">人数</dt><dd>大人{cond.adults}人{cond.children.length ? `、子ども${cond.children.length}人（${cond.children.map((c) => `${c.age}歳${c.heightCm ? `・${c.heightCm}cm` : ""}`).join("、")}）` : "、子ども0人"}</dd></div>
            <div><dt className="font-semibold">重視する点（3プラン共通）</dt><dd className="whitespace-pre-wrap">{cond.priority || "（なし）"}</dd></div>
            <div><dt className="font-semibold">歩く速さ</dt><dd>{cond.walkSpeed === 55 ? "ゆっくり" : cond.walkSpeed === 70 ? "少しゆっくり" : cond.walkSpeed === 85 ? "少し急いで" : "急いで"}</dd></div>
          </dl>
        </div>
      ) : set.status === "creating" ? (
        <CreatingView setId={set.id} startedAt={startedAt} progress={progress} />
      ) : set.status === "failed" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <p className="text-base font-bold">作成に失敗しました</p>
          <p className="mt-2 text-sm leading-relaxed">このセットは失敗状態です。条件は残っているので、リトライで最初から作り直せます。</p>
          <button type="button" onClick={() => retry.mutate()} disabled={retry.isPending} className="mt-4 w-full rounded-lg bg-[var(--accent)] px-4 py-3 font-semibold text-white">
            リトライ
          </button>
        </div>
      ) : selectedPlan ? (
        <PlanDetail key={selectedPlan.id} set={set} plan={selectedPlan} />
      ) : (
        <p className="px-4 py-6 text-sm text-[var(--dim)]">このプランはまだありません。</p>
      )}
    </div>
  );
}
