// 「我が家のディズニー計画」（最小版）— 仕様書どおりの実装。
// 会話・条件・施設辞書・エリア間移動時間・待ち時間参考サイト・スナップショット・
// ファクト・プランセット・プラン・行・実行記録をサーバー側で保持する。

import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, asc, desc, eq } from "drizzle-orm";
import * as schema from "./schema";

// ---------- 共通の型・ユーティリティ ----------

const childSchema = z.object({
  age: z.number().int().min(0).max(17),
  heightCm: z.number().int().min(0).max(250).nullable(),
});
const conditionSchema = z.object({
  park: z.enum(["sea", "land"]),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entryTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  exitTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  budget: z.number().int().min(0),
  adults: z.number().int().min(0),
  children: z.array(childSchema).max(20),
  priority: z.string().max(4000),
  walkSpeed: z.number().int(),
});
type Condition = z.infer<typeof conditionSchema>;

const rowSchema = z.object({
  kind: z.enum(["attraction", "show", "parade", "restaurant", "break", "move", "other", "purchase", "first10"]),
  facilityName: z.string().max(200),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  waitMinutes: z.number().int().min(0).nullable(),
  purchaseTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  price: z.number().int().min(0).nullable(),
  targetCount: z.number().int().min(0).nullable(),
  note: z.string().max(2000),
  uncertain: z.boolean(),
  uncertainReason: z.string().max(500).nullable(),
});
const planSubmitSchema = z.object({
  slot: z.enum(["A", "B", "C"]),
  title: z.string().max(200),
  summary: z.string().max(4000),
  total: z.number().int().min(0),
  breakdown: z.object({
    ticket: z.number().int().min(0),
    dpa: z.number().int().min(0),
    dpaDetail: z.string().max(2000),
    food: z.number().int().min(0),
    other: z.number().int().min(0),
  }),
  scenario: z.string().max(1000),
  droppedRequests: z.array(z.object({ request: z.string().max(500), reason: z.string().max(1000) })).max(30),
  budgetDisclosure: z.string().max(2000).nullable(),
  rows: z.array(rowSchema).max(120),
});
const dayDataSchema = z.object({
  openTime: z.string().regex(/^\d{2}:\d{2}$/),
  closeTime: z.string().regex(/^\d{2}:\d{2}$/),
  closures: z.array(z.string().max(200)).max(100),
  showTimes: z.record(z.string(), z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(20)),
  ticketAdult: z.number().int().min(0),
  ticketChildPrices: z.array(z.number().int().min(0)).max(20),
});

function toMin(t: string): number {
  const [h = 0, m = 0] = t.split(":").map(Number);
  return h * 60 + m;
}

// 行の時間順（表示・保存の正規順序）。生成タスクが提出した配列順は信用せず、
// 行の時刻そのものから機械的に並べ直す。購入行は購入時刻、それ以外の行は
// 開始時刻をその行の時刻とする（片方が無ければもう一方で代用）。
// 時刻を持たない行（移動行など）は、直前の行の時刻を引き継いでその直後に
// 留まる（先頭で時刻が無い場合は次の時刻つき行の時刻を引き継ぐ）。
// 同時刻の同点順位は first10 → 購入 → 通常行 → 移動行とし、それでも
// 並ぶ場合は元の相対順を保つ（安定ソート）。
type RowTimeLike = { kind: string; startTime: string | null; purchaseTime: string | null };
function sortRowsByTime<T extends RowTimeLike>(rows: readonly T[]): T[] {
  const keys: (number | null)[] = rows.map((r) => {
    const t = r.kind === "purchase" ? (r.purchaseTime ?? r.startTime) : (r.startTime ?? r.purchaseTime);
    return t ? toMin(t) : null;
  });
  let last: number | null = null;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k != null) last = k;
    else if (last != null) keys[i] = last;
  }
  let next: number | null = null;
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i];
    if (k != null) next = k;
    else if (next != null) keys[i] = next;
  }
  const rank = (kind: string): number =>
    kind === "first10" ? 0 : kind === "purchase" ? 1 : kind === "move" ? 3 : 2;
  return rows
    .map((r, i) => ({ r, i, k: keys[i] ?? 0, rank: rank(r.kind) }))
    .sort((a, b) => a.k - b.k || a.rank - b.rank || a.i - b.i)
    .map((x) => x.r);
}
function totalPeople(c: Condition): number {
  return c.adults + c.children.length;
}
function parkLabel(park: string): string {
  return park === "sea" ? "シー" : "ランド";
}
function conditionSummary(c: Condition): string {
  const kids = c.children.length
    ? c.children.map((k) => `子ども（${k.age}歳${k.heightCm ? `・${k.heightCm}cm` : ""}）`).join("、")
    : "子ども0人";
  const speedLabel = c.walkSpeed === 55 ? "ゆっくり" : c.walkSpeed === 70 ? "少しゆっくり" : c.walkSpeed === 85 ? "少し急いで" : "急いで";
  return [
    `来園日：${c.visitDate}`,
    `パーク：${parkLabel(c.park)}`,
    `人数：大人${c.adults}人、${kids}`,
    `予算：${c.budget.toLocaleString()}円`,
    `入園時刻：${c.entryTime ?? "未定"}`,
    `退園時刻：${c.exitTime ?? "未定"}`,
    `歩く速さ：${speedLabel}`,
    `重視する点：${c.priority || "（なし）"}`,
  ].join("\n");
}

// ---------- 第7節：移動時間の決定論的計算 ----------

const ENTRANCE: Record<string, { lat: number; lng: number; area: string }> = {
  land: { lat: 35.6343228, lng: 139.8795861, area: "ワールドバザール" },
  sea: { lat: 35.6264517, lng: 139.8869221, area: "メディテレーニアンハーバー" },
};

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

type FacilityInfo = { lat: number | null; lng: number | null; area: string; durationMin: number | null; officialUrl: string | null };

async function facilityMap(ctx: Ctx, park: string): Promise<Map<string, FacilityInfo>> {
  const db = ctx.db<typeof schema>();
  const rows = await db.select().from(schema.facilities).where(eq(schema.facilities.park, park));
  const map = new Map<string, FacilityInfo>();
  for (const r of rows) map.set(r.name, { lat: r.lat, lng: r.lng, area: r.area, durationMin: r.durationMin, officialUrl: r.officialUrl });
  return map;
}

async function moveTable(ctx: Ctx, park: string): Promise<Map<string, number>> {
  const db = ctx.db<typeof schema>();
  const rows = await db.select().from(schema.areaMoves).where(eq(schema.areaMoves.park, park));
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(`${r.areaA}|${r.areaB}`, r.minutes);
    map.set(`${r.areaB}|${r.areaA}`, r.minutes);
  }
  return map;
}

function resolvePoint(name: string, park: string, fmap: Map<string, FacilityInfo>): { lat: number; lng: number; area: string } | null {
  const ent = ENTRANCE[park];
  if (!name || !ent) return null;
  const f = fmap.get(name);
  if (f && f.lat != null && f.lng != null) return { lat: f.lat, lng: f.lng, area: f.area };
  if (f && f.area === "パークワイド") return { lat: ent.lat, lng: ent.lng, area: ent.area };
  if (!f) return null;
  return null;
}

// 移動時間（分）と歩行距離概算（m）。計算できない場合は null。
function calcMove(
  fromName: string,
  toName: string,
  park: string,
  speed: number,
  fmap: Map<string, FacilityInfo>,
  moves: Map<string, number>,
): { minutes: number; walkM: number } | null {
  const a = resolvePoint(fromName, park, fmap);
  const b = resolvePoint(toName, park, fmap);
  if (!a || !b) return null;
  const d = haversineM(a.lat, a.lng, b.lat, b.lng);
  const detour = d <= 100 ? 1.1 : d <= 300 ? 1.2 : d <= 600 ? 1.25 : 1.3;
  let minutes = (d / speed) * detour;
  const tableVal = moves.get(`${a.area}|${b.area}`);
  if (tableVal != null && a.area !== b.area) {
    minutes = Math.max(minutes, (tableVal * 70) / speed);
  }
  minutes = Math.ceil(minutes * 1.2);
  if (fromName !== toName) minutes = Math.max(5, minutes);
  return { minutes, walkM: Math.round(d * detour) };
}

function durationFromNote(note: string): number | null {
  const m = note.match(/所要約(\d+)分/);
  return m ? Number(m[1]) : null;
}

// ---------- 第11節：進捗行とタスク管理 ----------

type ProgressLine = { at: number; text: string; kind?: string; slot?: string; instruction?: string };

function parseProgress(json: string): ProgressLine[] {
  try {
    const v = JSON.parse(json) as ProgressLine[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// 作成中セットについて、経過1分ごとの行をサーバー時計で補い、
// 進捗が20分途絶えた実行を失敗として閉じる（第11.1・11.2節）。
async function maintainRuns(ctx: Ctx): Promise<void> {
  const db = ctx.db<typeof schema>();
  const now = Date.now();
  const running = await db.select().from(schema.runs).where(eq(schema.runs.status, "running"));
  for (const run of running) {
    // 20分途絶 → 失敗として閉じる
    if (now - run.lastProgressAt > 20 * 60 * 1000) {
      await db.update(schema.runs).set({ status: "failed", finishedAt: now }).where(eq(schema.runs.id, run.id));
      if (run.setId != null && (run.kind === "create" || run.kind === "rebuild")) {
        await db.update(schema.planSets).set({ status: "failed" }).where(eq(schema.planSets.id, run.setId));
      }
      if (run.setId != null && run.kind === "replace") {
        await db.update(schema.planSets).set({ status: "complete" }).where(eq(schema.planSets.id, run.setId));
      }
      if (run.kind === "create" || run.kind === "rebuild" || run.kind === "replace") {
        await db.insert(schema.messages).values({
          role: "assistant",
          text: "現在museが混雑しています。申し訳ありませんが、しばらく後に再度お試しください。",
          createdAt: now,
        });
      }
      continue;
    }
    // 1分ごとの行（プラン系のみ）
    if (run.setId != null && (run.kind === "create" || run.kind === "rebuild" || run.kind === "replace")) {
      const setRows = await db.select().from(schema.planSets).where(eq(schema.planSets.id, run.setId));
      const set = setRows[0];
      if (set && set.status === "creating" && set.startedAt) {
        const lines = parseProgress(set.progressJson);
        const elapsedMin = Math.floor((now - set.startedAt) / 60000);
        const minuteLines = lines.filter((l) => l.kind === "minute").length;
        if (elapsedMin > minuteLines) {
          const label = run.progressLabel || "その日の情報を、公式サイトで確認しています。";
          for (let i = minuteLines; i < elapsedMin; i++) {
            lines.push({
              at: set.startedAt + (i + 1) * 60000,
              text: i === 0 ? label : `まだ${label.replace(/しています。$/, "しています。")}`,
              kind: "minute",
            });
          }
          await db.update(schema.planSets).set({ progressJson: JSON.stringify(lines) }).where(eq(schema.planSets.id, set.id));
        }
      }
    }
  }
}

async function setTitleFor(ctx: Ctx, cond: Condition): Promise<string> {
  const db = ctx.db<typeof schema>();
  const base = `${cond.visitDate}（${parkLabel(cond.park)}）`;
  const existing = await db.select().from(schema.planSets);
  const same = existing.filter((s) => {
    try {
      const c = JSON.parse(s.conditionJson) as Condition;
      return c.visitDate === cond.visitDate && c.park === cond.park;
    } catch {
      return false;
    }
  }).length;
  return same > 0 ? `(${same + 1}) ${base}` : base;
}

async function createSetAndRun(
  ctx: Ctx,
  cond: Condition,
  origin: "form" | "chat_new" | "rebuild",
  originSetId: number | null,
): Promise<{ setId: number; runId: number; title: string }> {
  const db = ctx.db<typeof schema>();
  const now = Date.now();
  const title = await setTitleFor(ctx, cond);
  const [set] = await db
    .insert(schema.planSets)
    .values({
      title,
      status: "creating",
      origin,
      originSetId,
      conditionJson: JSON.stringify(cond),
      progressJson: JSON.stringify([{ at: now, text: "作成を開始しました。", kind: "start" } satisfies ProgressLine]),
      startedAt: now,
      createdAt: now,
    })
    .returning({ id: schema.planSets.id });
  if (!set) throw new Error("プランセットの作成に失敗しました");
  const [run] = await db
    .insert(schema.runs)
    .values({ kind: origin === "rebuild" ? "rebuild" : "create", setId: set.id, status: "running", startedAt: now, lastProgressAt: now, progressLabel: "その日の情報を、公式サイトで確認しています。" })
    .returning({ id: schema.runs.id });
  if (!run) throw new Error("実行記録の作成に失敗しました");
  return { setId: set.id, runId: run.id, title };
}

function generationTaskPrompt(setId: number, runId: number, mode: "create" | "rebuild" | "replace", extra: string): string {
  return [
    `あなたは「我が家のディズニー計画」アプリのプラン生成タスクです。プランセットID=${setId}、実行ID=${runId}、モード=${mode}。`,
    extra,
    `手順（仕様書第5〜9節）:`,
    `1. アクション getGenerationContext（setId=${setId}）で条件・施設辞書・混雑予想キャッシュ・参考サイトを読む。`,
    `2. 東京ディズニーリゾート公式サイトをブラウザで実際に開いて取得する（テキストだけの読み取りで済ませない）。サイトマップ https://www.tokyodisneyresort.jp/sitemap.xml から辿り、(a)対象パークのDPA案内ページ全文、(b)対象パークの施設全一覧、(c)対象日の日付つきデイリーページ（営業時間・休止施設・ショー公演時刻）、(d)月間カレンダーとチケットページ（対象日の1デーパスポート大人価格）、(e)採用するレストランの公式詳細ページ全文、を取得する。各ページは reportProgress で開始と終了を記録し、saveSnapshot（fetchMethod は "browser"、本文は生テキスト全文、要約・整形しない）で保存する。宣言件数と列挙件数が一致する等、ページ自身から完全性を照合できたものだけ isCanon=1 とする。ブラウザで取得できないページがある場合は代替取得でごまかさず failGeneration で理由を返して失敗として報告する。`,
    `3. アクション buildFacts（setId=${setId}）を呼ぶ。サーバーがファクト一式を構築・検証する。完全でない場合は材料を読み直して再取得し、再度 buildFacts を呼ぶ。`,
    `4. 混雑予想: congestionCache があればそれを使う。無ければ待ち時間参考サイト等で対象日の混雑を調査し（主軸=外部の混雑予想、補助=季節統計とチケット価格帯）、saveCongestion で段階(1〜5)と根拠と材料を保存する。推定待ち時間の材料も参考サイトから集める。取れないサイトは材料に使えなかった旨を根拠に含める。`,
    `5. 無理の判定（第8節）: 施設一覧に無い施設の要求、対象日に休止・公演なしが確定している施設の要求、最も緩い前提でも入園〜退園の枠に収まらない要求、直接矛盾する要求、のいずれかに当たる場合だけ、組み立てず failGeneration（impossibleCategory と impossibleDetail を付ける）で返す。予算は無理の判定に入れない。`,
    `6. 3プラン（A=激混み前提、B=やや混み前提、C=思ったより空いてる前提）を組み立てる。単一の「重視する点」を全プラン共通で効かせる。DPAは購入イベント行（kind="purchase"）でのみ費用計上し、購入時刻を持たせ、60分ルールを守り、人気施設（推定待ちが大きい施設）ほど早く買う。全アトラクション行とショー行に推定待ち時間を持たせる。レストラン行に推定待ちは付けない。各プランに first10 行（抽選対象ショーと最初のDPA購入がある場合のみ）を入園直後に置く。行は必ず時間順に並べる（購入行は購入時刻の位置に入れ、利用行とは別に並べる。購入行だけを先頭にまとめて置かない）。落とした要求は droppedRequests に理由つきで列挙する。予算を超えるプランには budgetDisclosure を必ず付ける。`,
    `7. submitPlans で提出する。検証で拒否されたら理由を読んで組み直し、再提出する（拒否されたまま終えない）。`,
    `8. 進捗は reportProgress（runId=${runId}）で工程ごとに記録する。`,
    mode === "replace"
      ? `部分差し替えでは submitReplacement を使い、対象プランだけを提出する。他のプランには触れない。`
      : ``,
  ].join("\n");
}

function spawnGeneration(ctx: Ctx, setId: number, runId: number, mode: "create" | "rebuild" | "replace", extra: string): void {
  ctx.agent.spawnTask(generationTaskPrompt(setId, runId, mode, extra));
}

// ---------- 第9節：保存時の検証（ゲート） ----------

type GateInput = z.infer<typeof planSubmitSchema>;

async function validatePlan(
  ctx: Ctx,
  cond: Condition,
  plan: GateInput,
  factSetId: number | null,
  day: z.infer<typeof dayDataSchema>,
  fmap: Map<string, FacilityInfo>,
  moves: Map<string, number>,
): Promise<{ errors: string[]; unconfirmed: string[]; moveTotal: number; walkTotal: number }> {
  const db = ctx.db<typeof schema>();
  const errors: string[] = [];
  const unconfirmed: string[] = [];
  const people = totalPeople(cond);

  // 9.2-10 最低内容
  if (!plan.title.trim() || plan.title.trim() === plan.slot) errors.push(`プラン${plan.slot}: タイトルが無い、またはスロット文字だけの仮タイトルです`);
  if (/テスト/.test(plan.title)) errors.push(`プラン${plan.slot}: タイトルがテストデータを示す文面です`);
  if (plan.summary.replace(/\s/g, "").length < 10) errors.push(`プラン${plan.slot}: 要約の実質文字数が10文字未満です`);
  const realRows = plan.rows.filter((r) => r.kind === "attraction" || r.kind === "show" || r.kind === "parade" || r.kind === "restaurant");
  if (!plan.rows.some((r) => r.kind === "attraction" || r.kind === "show" || r.kind === "parade"))
    errors.push(`プラン${plan.slot}: アトラクションまたはショーの実項目が1つもありません`);
  if (realRows.length < 6) errors.push(`プラン${plan.slot}: 実項目（アトラクション・ショー・食事）が${realRows.length}行で、6行未満です`);
  const bd = plan.breakdown;
  if (bd.ticket + bd.dpa + bd.food + bd.other !== plan.total)
    errors.push(`プラン${plan.slot}: 内訳の合計（${bd.ticket + bd.dpa + bd.food + bd.other}円）が総額（${plan.total}円）と一致しません`);
  const floor = cond.adults * day.ticketAdult + day.ticketChildPrices.reduce((a, b) => a + b, 0);
  if (plan.total < floor) errors.push(`プラン${plan.slot}: 費用合計（${plan.total}円）がチケット代合計（${floor}円）を下回っています`);
  // 9.2-12 予算開示
  if (plan.total > cond.budget && !plan.budgetDisclosure)
    errors.push(`プラン${plan.slot}: 予算（${cond.budget}円）を${plan.total - cond.budget}円超えていますが、予算超過の開示が含まれていません`);

  // ファクト読み込み
  let factMap = new Map<string, { status: string; price: number | null; startDate: string | null; endDate: string | null; reason: string | null }>();
  let factComplete = false;
  if (factSetId != null) {
    const fs = await db.select().from(schema.factSets).where(eq(schema.factSets.id, factSetId));
    if (fs[0]) {
      factComplete = fs[0].complete === 1;
      const fs2 = await db.select().from(schema.facts).where(eq(schema.facts.factSetId, factSetId));
      factMap = new Map(fs2.map((f) => [f.facilityName, { status: f.status, price: f.price, startDate: f.startDate, endDate: f.endDate, reason: f.reason }]));
    }
  }

  // 行ごとの検証
  let dpaSum = 0;
  const purchases: { purchaseTime: string; useStart: string; name: string }[] = [];
  for (const row of plan.rows) {
    if (row.kind === "purchase") {
      // 9.1 / 9.2-1,2,7
      if (!factComplete) {
        errors.push(`プラン${plan.slot}: ファクト一式が無い、または不完全なため、DPAの行（${row.facilityName}）は全て拒否されます`);
        continue;
      }
      const fact = factMap.get(row.facilityName);
      if (!fact) {
        errors.push(`プラン${plan.slot}: ${row.facilityName} のファクトがありません`);
        continue;
      }
      if (fact.status === "not_eligible") errors.push(`プラン${plan.slot}: ${row.facilityName} はDPA対象外です`);
      else if (fact.status === "unknown") {
        errors.push(`プラン${plan.slot}: ${row.facilityName} のDPA対象可否が未確認のため拒否します`);
        unconfirmed.push(`${row.facilityName}：未確認（${fact.reason ?? "理由なし"}）`);
      } else {
        if (fact.startDate && cond.visitDate < fact.startDate)
          errors.push(`プラン${plan.slot}: ${row.facilityName} は対象日が適用期間の外です（適用開始日 ${fact.startDate}）`);
        if (fact.endDate && cond.visitDate > fact.endDate)
          errors.push(`プラン${plan.slot}: ${row.facilityName} は対象日が適用期間の外です（適用終了日 ${fact.endDate}）`);
        if (row.price == null || row.price !== fact.price)
          errors.push(`プラン${plan.slot}: ${row.facilityName} の購入単価（${row.price ?? "なし"}）がファクト単価（${fact.price ?? "なし"}）と一致しません`);
      }
      if (!row.purchaseTime) errors.push(`プラン${plan.slot}: ${row.facilityName} の購入行に購入時刻がありません`);
      if (row.targetCount == null || row.targetCount < 1 || row.targetCount > people)
        errors.push(`プラン${plan.slot}: ${row.facilityName} の対象人数（${row.targetCount ?? "なし"}）が不正です（参加者総数 ${people}）`);
      else if (row.price != null) dpaSum += row.price * row.targetCount;
      // 利用行（同施設のアトラクション/ショー行）を探す
      const useRow = plan.rows.find((r) => r.facilityName === row.facilityName && (r.kind === "attraction" || r.kind === "show") && r.startTime);
      if (row.purchaseTime) purchases.push({ purchaseTime: row.purchaseTime, useStart: useRow?.startTime ?? row.purchaseTime, name: row.facilityName });
    }
    if (row.kind === "attraction" || row.kind === "show") {
      if (row.waitMinutes == null) errors.push(`プラン${plan.slot}: ${row.facilityName} の行に推定待ち時間がありません`);
    }
    if (row.facilityName && day.closures.includes(row.facilityName) && row.kind !== "purchase" && row.kind !== "first10")
      errors.push(`プラン${plan.slot}: ${row.facilityName} は対象日の休止施設です`);
    if (row.startTime && row.kind !== "first10") {
      const st = toMin(row.startTime);
      if (st < toMin(day.openTime) || st > toMin(day.closeTime))
        errors.push(`プラン${plan.slot}: ${row.facilityName} の開始時刻 ${row.startTime} が営業時間（${day.openTime}〜${day.closeTime}）の外です`);
      const dur = fmap.get(row.facilityName)?.durationMin ?? durationFromNote(row.note);
      const upper = Math.min(cond.exitTime ? toMin(cond.exitTime) : toMin(day.closeTime), toMin(day.closeTime));
      if (dur != null && row.startTime && st + dur > upper)
        errors.push(`プラン${plan.slot}: ${row.facilityName} は開始時刻＋所要時間（${dur}分）が上限（退園時刻と閉園時刻の早い方）を超えます`);
    }
    if ((row.kind === "show" || row.kind === "parade") && row.startTime) {
      const official = day.showTimes[row.facilityName];
      if (official && official.length > 0 && !official.includes(row.startTime)) {
        errors.push(`プラン${plan.slot}: ${row.facilityName} の開始時刻 ${row.startTime} が公式公演時刻（${official.join(", ")}）と一致しません`);
      }
      if ((!official || official.length === 0) && !row.uncertain) {
        // 公式公演時刻が材料に無い行は、未確定として明示されていない限り注記する
        unconfirmed.push(`${row.facilityName}：公式公演時刻が材料にありません`);
      }
    }
    if (row.uncertain && !row.uncertainReason) errors.push(`プラン${plan.slot}: ${row.facilityName} の未確定の行に理由がありません`);
    if (row.uncertain && row.uncertainReason) unconfirmed.push(`${row.facilityName}：未確定（${row.uncertainReason}）`);
  }
  if (dpaSum !== bd.dpa) errors.push(`プラン${plan.slot}: 購入イベント行の「単価×対象人数」の合計（${dpaSum}円）が内訳のDPA金額（${bd.dpa}円）と一致しません`);

  // 9.2-6 60分ルール
  const sorted = [...purchases].sort((a, b) => toMin(a.purchaseTime) - toMin(b.purchaseTime));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (!prev || !cur) continue;
    const earliest = Math.min(toMin(prev.purchaseTime) + 60, toMin(prev.useStart));
    if (toMin(cur.purchaseTime) < earliest)
      errors.push(`プラン${plan.slot}: ${cur.name} の購入時刻 ${cur.purchaseTime} が60分ルール（前回購入 ${prev.purchaseTime}、前回利用開始 ${prev.useStart}）に違反しています`);
  }

  // 9.2-9 スケジュール矛盾＋移動合計（第7節）
  let moveTotal = 0;
  let walkTotal = 0;
  const timed = plan.rows.filter((r) => r.startTime && r.kind !== "first10" && r.kind !== "purchase");
  for (let i = 1; i < timed.length; i++) {
    const prev = timed[i - 1];
    const cur = timed[i];
    if (!prev || !cur || !prev.startTime || !cur.startTime) continue;
    const prevWait = prev.kind === "restaurant" ? 0 : (prev.waitMinutes ?? 0);
    const prevDur = fmap.get(prev.facilityName)?.durationMin ?? durationFromNote(prev.note) ?? 0;
    const mv = calcMove(prev.facilityName, cur.facilityName, cond.park, cond.walkSpeed, fmap, moves);
    let need: number;
    if (mv) {
      need = prevWait + prevDur + mv.minutes;
      moveTotal += mv.minutes;
      walkTotal += mv.walkM;
    } else {
      need = prevWait + 10;
      unconfirmed.push(`移動時間（${prev.facilityName}→${cur.facilityName}）：未確認`);
    }
    const floorNeed = prevWait + 10;
    const gap = toMin(cur.startTime) - toMin(prev.startTime);
    if (gap < Math.max(need, floorNeed))
      errors.push(`プラン${plan.slot}: ${prev.facilityName}（${prev.startTime}）→${cur.facilityName}（${cur.startTime}）の間隔 ${gap}分 が必要量（推定待ち${prevWait}＋所要${prevDur}＋移動${mv ? mv.minutes : 10}）を満たしません`);
  }
  return { errors, unconfirmed, moveTotal, walkTotal };
}

async function persistPlan(
  ctx: Ctx,
  setId: number,
  plan: GateInput,
  fmap: Map<string, FacilityInfo>,
): Promise<number> {
  const db = ctx.db<typeof schema>();
  const [p] = await db
    .insert(schema.plans)
    .values({
      setId,
      slot: plan.slot,
      title: plan.title,
      summary: plan.summary,
      total: plan.total,
      breakdownJson: JSON.stringify(plan.breakdown),
      scenario: plan.scenario,
      notes: JSON.stringify({ droppedRequests: plan.droppedRequests, budgetDisclosure: plan.budgetDisclosure }),
    })
    .returning({ id: schema.plans.id });
  if (!p) throw new Error("プランの保存に失敗しました");
  for (let i = 0; i < plan.rows.length; i++) {
    const r = plan.rows[i];
    if (!r) continue;
    const fac = r.facilityName ? fmap.get(r.facilityName) : undefined;
    await db.insert(schema.planRows).values({
      planId: p.id,
      ord: i,
      kind: r.kind,
      facilityName: r.facilityName,
      startTime: r.startTime,
      waitMinutes: r.kind === "restaurant" ? null : r.waitMinutes,
      purchaseTime: r.purchaseTime,
      price: r.price,
      targetCount: r.targetCount,
      note: r.note,
      uncertain: r.uncertain ? 1 : 0,
      uncertainReason: r.uncertainReason,
      officialUrl: fac?.officialUrl ?? null,
    });
  }
  return p.id;
}

// ---------- アクション ----------

const okResponse = z.object({ ok: z.literal(true) });

export const Actions = {
  getState: defineAction({
    description: "アプリ全体の状態（会話・保存済み条件・プランセット一覧・参考サイト・件数）を取得する。",
    request: z.object({}),
    response: z.object({
      messages: z.array(z.object({ id: z.number(), role: z.string(), text: z.string(), createdAt: z.number() })),
      savedCondition: conditionSchema.nullable(),
      waitSites: z.array(z.object({ id: z.number(), name: z.string(), url: z.string(), park: z.string(), provides: z.string() })),
      planSets: z.array(
        z.object({
          id: z.number(),
          title: z.string(),
          status: z.string(),
          origin: z.string(),
          isRebuild: z.boolean(),
          condition: conditionSchema,
          startedAt: z.number().nullable(),
          progress: z.array(z.object({ at: z.number(), text: z.string() })),
          hasCongestion: z.boolean(),
        }),
      ),
      counts: z.object({ fixedTabs: z.number(), planSetTabs: z.number(), messages: z.number(), facilities: z.number(), areaMoves: z.number(), waitSites: z.number() }),
    }),
    async handler(ctx) {
      await maintainRuns(ctx);
      const db = ctx.db<typeof schema>();
      const msgs = await db.select().from(schema.messages).orderBy(desc(schema.messages.id)).limit(200);
      const allMsgCount = await db.select({ id: schema.messages.id }).from(schema.messages);
      const condRows = await db.select().from(schema.savedConditions);
      const c0 = condRows[0];
      const savedCondition: Condition | null = c0
        ? {
            park: c0.park as "sea" | "land",
            visitDate: c0.visitDate,
            entryTime: c0.entryTime,
            exitTime: c0.exitTime,
            budget: c0.budget,
            adults: c0.adults,
            children: (JSON.parse(c0.childrenJson) as { age: number; heightCm: number | null }[]).map((k) => ({ age: k.age, heightCm: k.heightCm ?? null })),
            priority: c0.priority,
            walkSpeed: c0.walkSpeed,
          }
        : null;
      const sites = await db.select().from(schema.waitSites).orderBy(asc(schema.waitSites.sort));
      const sets = await db.select().from(schema.planSets).orderBy(asc(schema.planSets.id));
      const facs = await db.select({ name: schema.facilities.name }).from(schema.facilities);
      const moves = await db.select({ id: schema.areaMoves.id }).from(schema.areaMoves);
      return {
        messages: msgs.reverse().map((m) => ({ id: m.id, role: m.role, text: m.text, createdAt: m.createdAt })),
        savedCondition,
        waitSites: sites.map((s) => ({ id: s.id, name: s.name, url: s.url, park: s.park, provides: s.provides })),
        planSets: sets.map((s) => ({
          id: s.id,
          title: s.title,
          status: s.status,
          origin: s.origin,
          isRebuild: s.origin === "rebuild",
          condition: JSON.parse(s.conditionJson) as Condition,
          startedAt: s.startedAt,
          progress: parseProgress(s.progressJson).filter((l) => l.kind !== "replace_request"),
          hasCongestion: s.congestionJson != null,
        })),
        counts: { fixedTabs: 4, planSetTabs: sets.length, messages: allMsgCount.length, facilities: facs.length, areaMoves: moves.length, waitSites: sites.length },
      };
    },
  }),

  getPlanSet: defineAction({
    description: "1つのプランセットの詳細（条件・混雑予想・検証の記録・プランと行・施設辞書）を取得する。",
    request: z.object({ setId: z.number().int().positive() }),
    response: z.object({
      found: z.boolean(),
      set: z
        .object({
          id: z.number(),
          title: z.string(),
          status: z.string(),
          isRebuild: z.boolean(),
          condition: conditionSchema,
          congestion: z.object({ level: z.number(), basis: z.string(), materials: z.array(z.string()) }).nullable(),
          verification: z.string().nullable(),
          plans: z.array(
            z.object({
              id: z.number(),
              slot: z.string(),
              title: z.string(),
              summary: z.string(),
              total: z.number(),
              breakdown: z.object({ ticket: z.number(), dpa: z.number(), dpaDetail: z.string(), food: z.number(), other: z.number() }),
              scenario: z.string(),
              droppedRequests: z.array(z.object({ request: z.string(), reason: z.string() })),
              budgetDisclosure: z.string().nullable(),
              moveTotal: z.number(),
              walkTotal: z.number(),
              rows: z.array(
                z.object({
                  id: z.number(),
                  ord: z.number(),
                  kind: z.string(),
                  facilityName: z.string(),
                  startTime: z.string().nullable(),
                  waitMinutes: z.number().nullable(),
                  purchaseTime: z.string().nullable(),
                  price: z.number().nullable(),
                  targetCount: z.number().nullable(),
                  note: z.string(),
                  uncertain: z.boolean(),
                  uncertainReason: z.string().nullable(),
                  officialUrl: z.string().nullable(),
                  lat: z.number().nullable(),
                  lng: z.number().nullable(),
                  moveMinutes: z.number().nullable(),
                  walkM: z.number().nullable(),
                }),
              ),
            }),
          ),
        })
        .nullable(),
    }),
    async handler(ctx, args) {
      await maintainRuns(ctx);
      const db = ctx.db<typeof schema>();
      const setRows = await db.select().from(schema.planSets).where(eq(schema.planSets.id, args.setId));
      const set = setRows[0];
      if (!set) return { found: false, set: null };
      const cond = JSON.parse(set.conditionJson) as Condition;
      const fmap = await facilityMap(ctx, cond.park);
      const moves = await moveTable(ctx, cond.park);
      const planList = await db.select().from(schema.plans).where(eq(schema.plans.setId, set.id)).orderBy(asc(schema.plans.slot));
      const plansOut = [];
      for (const p of planList) {
        // 表示順は保存された ord ではなく行の時刻から決める（時間順）。
        // 時間順に直る前の順序で保存された既存セットも、ここで正しい
        // 並びになる。移動行の前後判定もこの並び直しの後に行う。
        const rowList = sortRowsByTime(await db.select().from(schema.planRows).where(eq(schema.planRows.planId, p.id)).orderBy(asc(schema.planRows.ord)));
        let moveTotal = 0;
        let walkTotal = 0;
        const rowsOut = rowList.map((r, i) => {
          const fac = r.facilityName ? fmap.get(r.facilityName) : undefined;
          let lat: number | null = fac?.lat ?? null;
          let lng: number | null = fac?.lng ?? null;
          if (fac && fac.area === "パークワイド") {
            const ent = ENTRANCE[cond.park];
            lat = ent ? ent.lat : lat;
            lng = ent ? ent.lng : lng;
          }
          if (r.kind === "first10" || r.kind === "purchase") {
            // 購入イベント行は「その時刻に買う」行為であって行く場所では
            // ないので、座標を持たない（仕様書第4節）。対象施設の座標を
            // ここで付けると地図に同じ施設のピンが二重に出て、ピンの
            // 番号も「行く場所の順番」でなくなる。読み取り時に外すので、
            // 保存済みの既存セットもこの規則で表示される。
            lat = null;
            lng = null;
          }
          let moveMinutes: number | null = null;
          let walkM: number | null = null;
          if (r.kind === "move") {
            const prev = [...rowList.slice(0, i)].reverse().find((x) => x.kind !== "move" && x.kind !== "purchase" && x.kind !== "first10");
            const next = rowList.slice(i + 1).find((x) => x.kind !== "move" && x.kind !== "purchase" && x.kind !== "first10");
            if (prev && next) {
              const mv = calcMove(prev.facilityName, next.facilityName, cond.park, cond.walkSpeed, fmap, moves);
              if (mv) {
                moveMinutes = mv.minutes;
                walkM = mv.walkM;
                moveTotal += mv.minutes;
                walkTotal += mv.walkM;
              }
            }
          }
          return {
            id: r.id,
            ord: i,
            kind: r.kind,
            facilityName: r.facilityName,
            startTime: r.startTime,
            waitMinutes: r.waitMinutes,
            purchaseTime: r.purchaseTime,
            price: r.price,
            targetCount: r.targetCount,
            note: r.note,
            uncertain: r.uncertain === 1,
            uncertainReason: r.uncertainReason,
            officialUrl: r.officialUrl,
            lat,
            lng,
            moveMinutes,
            walkM,
          };
        });
        const notes = JSON.parse(p.notes || "{}") as { droppedRequests?: { request: string; reason: string }[]; budgetDisclosure?: string | null };
        plansOut.push({
          id: p.id,
          slot: p.slot,
          title: p.title,
          summary: p.summary,
          total: p.total,
          breakdown: JSON.parse(p.breakdownJson) as { ticket: number; dpa: number; dpaDetail: string; food: number; other: number },
          scenario: p.scenario,
          droppedRequests: notes.droppedRequests ?? [],
          budgetDisclosure: notes.budgetDisclosure ?? null,
          moveTotal,
          walkTotal,
          rows: rowsOut,
        });
      }
      return {
        found: true,
        set: {
          id: set.id,
          title: set.title,
          status: set.status,
          isRebuild: set.origin === "rebuild",
          condition: cond,
          congestion: set.congestionJson
            ? (JSON.parse(set.congestionJson) as { level: number; basis: string; materials: string[] })
            : null,
          verification: set.verificationJson,
          plans: plansOut,
        },
      };
    },
  }),

  startFromForm: defineAction({
    description: "プラン作成タブの条件を保存し、その条件で新規作成を開始する。",
    request: z.object({ condition: conditionSchema }),
    response: z.object({ ok: z.literal(true), setId: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; setId: number }> {
      const cond = args.condition;
      if (!cond.adults || cond.adults < 1) throw new Error("大人の人数が未入力または0のため、作成を開始できません。");
      if (!cond.budget || cond.budget < 1) throw new Error("予算が未入力または0のため、作成を開始できません。");
      const db = ctx.db<typeof schema>();
      await db
        .insert(schema.savedConditions)
        .values({
          id: 1,
          park: cond.park,
          visitDate: cond.visitDate,
          entryTime: cond.entryTime,
          exitTime: cond.exitTime,
          budget: cond.budget,
          adults: cond.adults,
          childrenJson: JSON.stringify(cond.children),
          priority: cond.priority,
          walkSpeed: cond.walkSpeed,
        })
        .onConflictDoUpdate({
          target: schema.savedConditions.id,
          set: {
            park: cond.park,
            visitDate: cond.visitDate,
            entryTime: cond.entryTime,
            exitTime: cond.exitTime,
            budget: cond.budget,
            adults: cond.adults,
            childrenJson: JSON.stringify(cond.children),
            priority: cond.priority,
            walkSpeed: cond.walkSpeed,
          },
        });
      const { setId, runId } = await createSetAndRun(ctx, cond, "form", null);
      spawnGeneration(ctx, setId, runId, "create", "開始経路はプラン作成タブのボタン（常に新規作成）。");
      ctx.invalidateQueries();
      return { ok: true as const, setId };
    },
  }),

  sendChatMessage: defineAction({
    description: "AIチャットへのメッセージを保存し、第10節・第12.1節の判定を行って返信と必要な開始処理を行う。",
    request: z.object({
      text: z.string().min(1).max(4000),
      openTab: z.object({
        type: z.string().max(50),
        setId: z.number().int().nullable(),
        slot: z.string().max(5).nullable(),
      }),
    }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const now = Date.now();
      await db.insert(schema.messages).values({ role: "user", text: args.text, createdAt: now });
      await maintainRuns(ctx);

      const sets = await db.select().from(schema.planSets).orderBy(asc(schema.planSets.id));
      const setsInfo = sets.map((s) => {
        const c = JSON.parse(s.conditionJson) as Condition;
        return { id: s.id, title: s.title, visitDate: c.visitDate, park: parkLabel(c.park), status: s.status };
      });
      // Q&A の根拠: 開いているセット、無ければ最後のセット
      let targetForQA: (typeof sets)[number] | undefined =
        args.openTab.setId != null ? sets.find((s) => s.id === args.openTab.setId) : undefined;
      if (!targetForQA) targetForQA = sets[sets.length - 1];
      let planDump = "";
      if (targetForQA) {
        const planList = await db.select().from(schema.plans).where(eq(schema.plans.setId, targetForQA.id));
        const parts: string[] = [];
        for (const p of planList) {
          const rowList = await db.select().from(schema.planRows).where(eq(schema.planRows.planId, p.id)).orderBy(asc(schema.planRows.ord));
          parts.push(
            `プラン${p.slot}「${p.title}」合計${p.total}円\n` +
              rowList.map((r) => `  ${r.startTime ?? "--:--"} ${r.kind} ${r.facilityName} ${r.waitMinutes != null ? `待ち${r.waitMinutes}分` : ""} ${r.note}`).join("\n"),
          );
        }
        planDump = parts.join("\n");
      }
      const recent = await db.select().from(schema.messages).orderBy(desc(schema.messages.id)).limit(16);
      const history = recent.reverse().map((m) => `${m.role === "user" ? "利用者" : "AI"}: ${m.text}`).join("\n");
      const condRows = await db.select().from(schema.savedConditions);
      const savedCondText = condRows[0] ? JSON.stringify(condRows[0]) : "（未保存）";

      const decisionSchema = z.object({
        action: z.enum(["new", "rebuild", "replace", "investigate", "site_update", "answer", "none", "ask_back"]),
        targetSetId: z.number().int().nullable(),
        targetSlot: z.enum(["A", "B", "C"]).nullable(),
        condition: conditionSchema.nullable(),
        changePoints: z.array(z.object({ field: z.string(), value: z.string() })).max(10),
        wheelchair: z.boolean(),
        impossibleCategory: z.string().nullable(),
        impossibleDetail: z.string().nullable(),
        reply: z.string(),
      });

      const decision = await ctx.inference.complete(
        [
          `あなたは「我が家のディズニー計画」アプリ内AIの判定役です。利用者のメッセージに対してアプリが行う動作を、第10節の規則で判断し、指定の枠で返してください。文面の言い回しの照合で弾いてはいけません。文脈から意図を読んでください。`,
          `規則:`,
          `- 純粋な質問・調査依頼・当日の事実の報告だけでは作成を始めない（action=answer か investigate）。`,
          `- あなたが変更内容を提示して確認を求めた後に利用者が肯定したら、それは開始指示であり必ず開始する。`,
          `- チャットから新規作成する場合の条件は会話で提示されたものだけから取る。保存済みフォーム条件を流用・補完に使わない。必須項目（日付・パーク・大人人数・予算・入園/退園時刻）が不足したら action=ask_back とし、不足分だけを reply で聞き返す。子どもの記載が無ければ子ども0人で確定し、不足にしない。`,
          `- 特定のプラン（A/B/C）を名指しした要素変更（例「プランAの夕食を18時に」）は部分差し替え（action=replace）。「重視する点」に触れていても条件変更にしない。プランを名指ししないセット全体の条件変更は changePoints に項目と新しい値を入れ、作り直し（action=rebuild、condition は変更適用後の全条件）として扱う。部分差し替えの判定に条件変更点が含まれる場合も rebuild にする。`,
          `- 変更操作の対象セットが文脈・開いているタブ・明示の指定のいずれでも1つに決まらない場合は action=ask_back とし、reply で全セットを来園日・パーク・状態つきの一覧で挙げて聞き返す。名指しされたセットを候補から黙って外さない。部分差し替えは完了状態のセットだけ。作り直しは失敗状態のセットからも可（条件だけ引き継ぐ）。`,
          `- プランの内容への質問には、下記の保存済みプランの行の実際の値（時刻・費用・内容）で答える。「詳細で確認してください」で済ませない。対象セットが特定できない参照のみ、最後のセットを規準にし、その旨を reply に含める。`,
          `- 車椅子利用者が参加者に含まれる条件は wheelchair=true にする（車椅子対応の有無を調べる調査依頼は除く）。`,
          `- 要求が「存在しない施設」「時間の明らかな無理」「直接矛盾する要求」のいずれかで明確に無理な場合だけ impossibleCategory（時間が足りない／○○は存在しない／○○と○○は矛盾する／その複合）と impossibleDetail（具体名・根拠）を入れる。迷う場合は無理にしない。予算は無理の判定に入れない。`,
          `- 制度・施設の調査依頼は action=investigate。参考サイトの追加・削除・再検索は action=site_update。ディズニー旅行計画と無関係・意味をなさない依頼は action=none とし、その旨を簡潔に reply に書く。`,
          `- reply は利用者への返信文。開始する場合は実際の動作と一致させる（差し替えと言うなら差し替えを開始すること）。`,
          ``,
          `開いているタブ: ${JSON.stringify(args.openTab)}`,
          `プランセット一覧: ${JSON.stringify(setsInfo)}`,
          `保存済みフォーム条件（チャット開始の条件には使わない）: ${savedCondText}`,
          `質問回答の根拠にできるセット（ID=${targetForQA ? targetForQA.id : "なし"}）の保存済みプラン:\n${planDump || "（プランなし）"}`,
          `会話の流れ:\n${history}`,
          `今回のメッセージ: ${args.text}`,
        ].join("\n"),
        { schema: decisionSchema },
      );

      const post = async (text: string) => {
        await db.insert(schema.messages).values({ role: "assistant", text, createdAt: Date.now() });
      };

      // 第10.7節 車椅子
      if (decision.wheelchair) {
        await post(
          [
            `車椅子の方が参加者に含まれる場合、本アプリでは対応できません。`,
            ``,
            `公式の仕組みをご案内します。`,
            `・ディスアビリティアクセスサービス（DAS）：障害者手帳等の証明書がある方が対象で、列に並ばず、待ち時間を別の場所で過ごすことができます（待ち時間自体は短縮されません）。`,
            `・合流利用サービス：証明書は不要で、本人は別の場所で待ち（介助者1名まで一緒に待つことができます）、同行者が列に並び、乗り場で合流します。`,
            `・公式サイトのバリアフリー案内「肢体不自由の方、車イスをご利用の方へ」に、車椅子で利用できる施設の一覧があります。`,
          ].join("\n"),
        );
        ctx.invalidateQueries();
        return { ok: true as const };
      }
      // 第10.6節 拒否（セットを作らない）
      if (decision.impossibleCategory) {
        await post(
          [
            `申し訳ありません。その条件ではプランを作成できませんでした。`,
            `原因：${decision.impossibleCategory}${decision.impossibleDetail ? `（${decision.impossibleDetail}）` : ""}`,
            `最初は緩めの条件で作り、できたプランへ修正を重ねていく方が良いですよ。`,
          ].join("\n"),
        );
        ctx.invalidateQueries();
        return { ok: true as const };
      }

      if (decision.action === "new" && decision.condition) {
        const { setId, runId } = await createSetAndRun(ctx, decision.condition, "chat_new", null);
        spawnGeneration(ctx, setId, runId, "create", "開始経路はチャット（新規作成）。条件はこのセットの条件の控えだけを使うこと。保存済みフォーム条件を読み替えないこと。");
        await post(`${decision.reply}\n\n実際に使う条件：\n${conditionSummary(decision.condition)}`);
      } else if (decision.action === "rebuild" && decision.condition) {
        const originId = decision.targetSetId;
        const { setId, runId } = await createSetAndRun(ctx, decision.condition, "rebuild", originId);
        spawnGeneration(
          ctx,
          setId,
          runId,
          "rebuild",
          originId != null
            ? `作り直し。元のセットID=${originId}。元のセットの構成（施設の顔ぶれ・大まかな順序）と座標・公式URL・エリアは getGenerationContext の元セットのプランから引き継ぎ、再取得しない。元が失敗状態なら引き継ぐのは条件だけ。DPA前提は今回新規に構築するファクトだけで決める。変更点をプランの説明（summary/notes）に記録する。`
            : `作り直し（元セットなし）。`,
        );
        await post(`${decision.reply}\n\n実際に使う条件：\n${conditionSummary(decision.condition)}`);
      } else if (decision.action === "replace" && decision.targetSetId != null && decision.targetSlot) {
        if (decision.changePoints.length > 0) {
          await post(`その変更は条件の変更を含むため、部分差し替えではなく作り直しとして扱う必要があります。変更後の条件を確定するため、変更したい項目と値をもう一度お知らせください。`);
        } else {
          const target = sets.find((s) => s.id === decision.targetSetId);
          if (!target || target.status !== "complete") {
            await post(`部分差し替えは、完了状態のプランセットに対してだけ行えます。対象のセット（ID=${decision.targetSetId}）は${target ? `現在「${target.status}」の状態` : "見つかりません"}のため、差し替えを開始できませんでした。`);
          } else {
            const now2 = Date.now();
            const lines = parseProgress(target.progressJson);
            lines.push({ at: now2, text: `プラン${decision.targetSlot}の差し替えを開始しました。`, kind: "replace_request", slot: decision.targetSlot, instruction: args.text });
            await db.update(schema.planSets).set({ status: "creating", startedAt: now2, progressJson: JSON.stringify(lines) }).where(eq(schema.planSets.id, target.id));
            const [run] = await db
              .insert(schema.runs)
              .values({ kind: "replace", setId: target.id, status: "running", startedAt: now2, lastProgressAt: now2, progressLabel: "差し替えの材料を、公式サイトで確認しています。" })
              .returning({ id: schema.runs.id });
            if (run) spawnGeneration(ctx, target.id, run.id, "replace", `部分差し替え。対象スロット=${decision.targetSlot}。利用者の指示: ${args.text}。対象プランだけを作り直し submitReplacement で提出する。他プランのデータは変更しない。変更しない購入については元の対象人数をそのまま使う。`);
            await post(decision.reply);
          }
        }
      } else if (decision.action === "investigate") {
        const now2 = Date.now();
        const [run] = await db
          .insert(schema.runs)
          .values({ kind: "investigate", setId: null, status: "running", startedAt: now2, lastProgressAt: now2, progressLabel: "公式サイトで確認しています。" })
          .returning({ id: schema.runs.id });
        if (run) {
          ctx.agent.spawnTask([
              `調査タスク（実行ID=${run.id}）。利用者の質問: ${args.text}`,
              `東京ディズニーリゾート公式サイトをブラウザで開いて確認し、聞かれた点ごとに「公式ページで確認できた点」と「確認できなかった点」を分けて書き、出典（ページ名・URL）を付けた回答を、アクション postTaskMessage（runId=${run.id}）でチャットに投稿する。確認できなかった点は推測で埋めない。ページ同士の記載が食い違う点は両方を挙げる。関係するページを1つも読めなかった場合だけ、失敗としてその旨を投稿する。プランもタブも作らない。`,
            ].join("\n"));
        }
        await post(decision.reply || "公式サイトで確認しています…");
      } else if (decision.action === "site_update") {
        const now2 = Date.now();
        const [run] = await db
          .insert(schema.runs)
          .values({ kind: "site_update", setId: null, status: "running", startedAt: now2, lastProgressAt: now2, progressLabel: "参考サイトを確認しています。" })
          .returning({ id: schema.runs.id });
        if (run) {
          ctx.agent.spawnTask([
              `待ち時間参考サイト更新タスク（実行ID=${run.id}）。利用者の指示: ${args.text}`,
              `対象サイトを実際に開いて確認する。追加の場合は applySiteUpdate（op=add）で登録する（既に同じURLが登録にある場合は重複登録しない）。削除は op=remove。集計データの最終更新が確認した日から1年以上前で、それ以降の集計データが無いサイトは更新が止まっているものとして外す（最終更新が確認できない場合は止まっていると決めない）。一部のサイトが開けない場合は開けたサイトで進め、開けなかったサイトは未確認として結果に含める。確認すべきサイトが1つも開けない場合だけ失敗として報告する。結果は postTaskMessage（runId=${run.id}）でチャットに報告する。プラン作成も調査も始めない。`,
            ].join("\n"));
        }
        await post(decision.reply || "参考サイトの更新を受け付けました。確認が終わったらお知らせします。");
      } else {
        await post(decision.reply || "承知しました。");
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  getGenerationContext: defineAction({
    description: "生成タスク用：セットの条件・施設辞書・移動時間表・参考サイト・混雑キャッシュ・元セットのプランを返す。",
    request: z.object({ setId: z.number().int().positive() }),
    response: z.object({
      found: z.boolean(),
      condition: conditionSchema.nullable(),
      originSetId: z.number().nullable(),
      originPlans: z.string(),
      facilities: z.array(z.object({ name: z.string(), area: z.string(), lat: z.number().nullable(), lng: z.number().nullable(), officialUrl: z.string().nullable(), durationMin: z.number().nullable() })),
      waitSites: z.array(z.object({ name: z.string(), url: z.string(), park: z.string(), provides: z.string() })),
      congestionCache: z.object({ level: z.number(), basis: z.string() }).nullable(),
      canonSnapshots: z.array(z.object({ id: z.number(), kind: z.string(), url: z.string(), createdAt: z.number() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const setRows = await db.select().from(schema.planSets).where(eq(schema.planSets.id, args.setId));
      const set = setRows[0];
      if (!set) return { found: false, condition: null, originSetId: null, originPlans: "", facilities: [], waitSites: [], congestionCache: null, canonSnapshots: [] };
      const cond = JSON.parse(set.conditionJson) as Condition;
      const facs = await db.select().from(schema.facilities).where(eq(schema.facilities.park, cond.park));
      const sites = await db.select().from(schema.waitSites).orderBy(asc(schema.waitSites.sort));
      const cc = await db.select().from(schema.congestionCache).where(and(eq(schema.congestionCache.park, cond.park), eq(schema.congestionCache.visitDate, cond.visitDate)));
      let originPlans = "";
      if (set.originSetId != null) {
        const op = await db.select().from(schema.plans).where(eq(schema.plans.setId, set.originSetId));
        const parts: string[] = [];
        for (const p of op) {
          const rl = sortRowsByTime(await db.select().from(schema.planRows).where(eq(schema.planRows.planId, p.id)).orderBy(asc(schema.planRows.ord)));
          parts.push(`プラン${p.slot}「${p.title}」: ` + rl.map((r) => `${r.startTime ?? ""} ${r.facilityName}`).join(" / "));
        }
        originPlans = parts.join("\n");
      }
      const now = Date.now();
      const snaps = await db.select().from(schema.snapshots).where(and(eq(schema.snapshots.park, cond.park), eq(schema.snapshots.isCanon, 1)));
      const fresh = snaps.filter((s) => s.kind === "daily" ? s.targetDate === cond.visitDate && now - s.createdAt < 3 * 3600 * 1000 : now - s.createdAt < 3 * 3600 * 1000);
      return {
        found: true,
        condition: cond,
        originSetId: set.originSetId,
        originPlans,
        facilities: facs.map((f) => ({ name: f.name, area: f.area, lat: f.lat, lng: f.lng, officialUrl: f.officialUrl, durationMin: f.durationMin })),
        waitSites: sites.filter((s) => s.park === cond.park || s.park === "both").map((s) => ({ name: s.name, url: s.url, park: s.park, provides: s.provides })),
        congestionCache: cc[0] ? { level: cc[0].level, basis: cc[0].basis } : null,
        canonSnapshots: fresh.map((s) => ({ id: s.id, kind: s.kind, url: s.url, createdAt: s.createdAt })),
      };
    },
  }),

  reportProgress: defineAction({
    description: "生成・調査タスクが工程の開始・終了と現在の作業ラベルを記録する。",
    request: z.object({ runId: z.number().int().positive(), label: z.string().min(1).max(500), setId: z.number().int().positive().nullable() }),
    response: okResponse,
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const now = Date.now();
      await db.update(schema.runs).set({ lastProgressAt: now, progressLabel: args.label }).where(eq(schema.runs.id, args.runId));
      if (args.setId != null) {
        const setRows = await db.select().from(schema.planSets).where(eq(schema.planSets.id, args.setId));
        const set = setRows[0];
        if (set) {
          const lines = parseProgress(set.progressJson);
          lines.push({ at: now, text: args.label, kind: "event" });
          await db.update(schema.planSets).set({ progressJson: JSON.stringify(lines) }).where(eq(schema.planSets.id, set.id));
        }
      }
      return { ok: true as const };
    },
  }),

  saveSnapshot: defineAction({
    description: "公式ページの生テキスト全文をスナップショットとして保存する（種別・URL・取得方法・正典可否つき）。",
    request: z.object({
      kind: z.string().min(1).max(50),
      park: z.enum(["sea", "land"]),
      targetDate: z.string().max(20).nullable(),
      url: z.string().url().max(1000),
      body: z.string().min(1).max(2000000),
      fetchMethod: z.string().min(1).max(50),
      isCanon: z.boolean(),
    }),
    response: z.object({ ok: z.literal(true), snapshotId: z.number() }),
    async handler(ctx, args): Promise<{ ok: true; snapshotId: number }> {
      const db = ctx.db<typeof schema>();
      const canon = args.isCanon && args.fetchMethod === "browser" ? 1 : 0;
      const [row] = await db
        .insert(schema.snapshots)
        .values({ kind: args.kind, park: args.park, targetDate: args.targetDate, url: args.url, body: args.body, fetchMethod: args.fetchMethod, isCanon: canon, createdAt: Date.now() })
        .returning({ id: schema.snapshots.id });
      if (!row) throw new Error("スナップショットの保存に失敗しました");
      return { ok: true as const, snapshotId: row.id };
    },
  }),

  buildFacts: defineAction({
    description: "正典スナップショットからファクト一式を構築し、第5.3節の機械検証を通して保存する。",
    request: z.object({ setId: z.number().int().positive() }),
    response: z.object({
      ok: z.literal(true),
      factSetId: z.number(),
      complete: z.boolean(),
      motherCount: z.number(),
      eligible: z.number(),
      notEligible: z.number(),
      unknown: z.number(),
      rejected: z.array(z.string()),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const setRows = await db.select().from(schema.planSets).where(eq(schema.planSets.id, args.setId));
      const set = setRows[0];
      if (!set) throw new Error("セットが見つかりません");
      const cond = JSON.parse(set.conditionJson) as Condition;
      const snaps = await db.select().from(schema.snapshots).where(and(eq(schema.snapshots.park, cond.park), eq(schema.snapshots.isCanon, 1)));
      const dpaSnap = snaps.filter((s) => s.kind === "dpa").sort((a, b) => b.createdAt - a.createdAt)[0];
      const listSnap = snaps.filter((s) => s.kind === "facility_list").sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!dpaSnap || !listSnap) throw new Error("正典スナップショット（DPA案内／施設全一覧）が不足しています。先にブラウザで取得して保存してください。");
      const facs = await db.select().from(schema.facilities).where(eq(schema.facilities.park, cond.park));
      const mother = facs.filter((f) => listSnap.body.includes(f.name)).map((f) => f.name);
      if (mother.length === 0) throw new Error("母集合（施設全一覧に載る施設）が導けませんでした。");

      const extractSchema = z.object({
        facts: z.array(
          z.object({
            facilityName: z.string(),
            status: z.enum(["eligible", "not_eligible", "unknown"]),
            price: z.number().int().nullable(),
            startDate: z.string().nullable(),
            endDate: z.string().nullable(),
            excerpt: z.string(),
            reason: z.string().nullable(),
          }),
        ).max(300),
      });
      const extracted = await ctx.inference.complete(
        [
          `DPA案内ページのテキストから、母集合の各施設についてファクトを取り出してください（第12.3節）。`,
          `規則: 施設名は母集合の名前と完全一致させる。ページに載っていない施設はどの行とも同一視せず、その施設は出力に含めない（サーバー側で未確認として補う）。状態・単価・適用期間が本文から読み取れない場合は推測せず status=unknown とし reason を付ける。excerpt は入力テキストの逐語の一部をそのまま切り取る（書き換え・要約は不可）。単価は excerpt 内に金額表記として現れる値にする。適用期間の日付は excerpt 内に日付表記として現れる場合だけ入れる。`,
          `母集合: ${mother.join("、")}`,
          `DPA案内ページ本文:\n${dpaSnap.body.slice(0, 60000)}`,
        ].join("\n"),
        { schema: extractSchema },
      );

      // 第5.3節 機械検証
      const rejected: string[] = [];
      const valid: z.infer<typeof extractSchema>["facts"] = [];
      const seen = new Set<string>();
      for (const f of extracted.facts) {
        if (!mother.includes(f.facilityName)) { rejected.push(`${f.facilityName}: 母集合に含まれない`); continue; }
        if (seen.has(f.facilityName)) { rejected.push(`${f.facilityName}: 重複`); continue; }
        seen.add(f.facilityName);
        if (!f.excerpt || !dpaSnap.body.includes(f.excerpt)) { rejected.push(`${f.facilityName}: 根拠抜粋がスナップショットの逐語部分文字列でない`); continue; }
        if (f.status === "eligible") {
          if (f.price == null || !new RegExp(`${f.price.toLocaleString()}|${f.price}`).test(f.excerpt)) { rejected.push(`${f.facilityName}: 単価が根拠抜粋に金額表記として現れていない`); continue; }
          if (f.startDate && !f.excerpt.includes(f.startDate) && !f.excerpt.replace(/-/g, "/").includes(f.startDate.replace(/-/g, "/"))) { rejected.push(`${f.facilityName}: 適用開始日が根拠抜粋に現れていない`); continue; }
          if (f.endDate && !f.excerpt.includes(f.endDate) && !f.excerpt.replace(/-/g, "/").includes(f.endDate.replace(/-/g, "/"))) { rejected.push(`${f.facilityName}: 適用終了日が根拠抜粋に現れていない`); continue; }
        }
        if (f.status === "unknown" && !f.reason) { rejected.push(`${f.facilityName}: 未確認の理由がない`); continue; }
        valid.push(f);
      }
      // 母集合の欠けは未確認として補う（一式の完全条件は「全施設に状態が付いていること」だが、
      // ページに載っていない施設は対象外とは断定できないため未確認にし、一式は不完全として扱う）
      const byName = new Map(valid.map((f) => [f.facilityName, f]));
      let complete = true;
      for (const name of mother) {
        if (!byName.has(name)) {
          byName.set(name, { facilityName: name, status: "unknown", price: null, startDate: null, endDate: null, excerpt: "", reason: "DPA案内ページに完全一致する行が無いため未確認" });
          complete = false;
        }
      }
      if (valid.some((f) => f.status === "unknown")) {
        // 未確認がある一式でも全施設に状態は付くが、DPA判定では未確認施設は拒否される。
        // 「完全」は全施設に状態が付き、かつ抽出が検証を通った一式を指すため、欠落補完があった場合のみ不完全とする。
      }
      // 第5.3節 値の連続性
      const prevSets = await db.select().from(schema.factSets).where(and(eq(schema.factSets.park, cond.park), eq(schema.factSets.complete, 1))).orderBy(desc(schema.factSets.id));
      const prev = prevSets.find((s) => s.setId !== args.setId);
      if (prev) {
        const prevFacts = await db.select().from(schema.facts).where(eq(schema.facts.factSetId, prev.id));
        const prevMap = new Map(prevFacts.map((f) => [f.facilityName, f]));
        for (const [name, f] of byName) {
          const pf = prevMap.get(name);
          if (!pf) continue;
          if (pf.status !== "unknown" && f.status !== "unknown") {
            const changed = pf.status !== f.status || pf.price !== f.price;
            if (changed && !f.startDate) {
              byName.set(name, { ...f, status: "unknown", reason: `前回の値（${pf.status}/${pf.price ?? "-"}）と異なり、新しい適用開始日を伴わないため未確認` });
              complete = false;
            }
          }
        }
      }
      const now = Date.now();
      const [fs] = await db
        .insert(schema.factSets)
        .values({ setId: args.setId, park: cond.park, visitDate: cond.visitDate, complete: complete ? 1 : 0, motherCount: mother.length, createdAt: now })
        .returning({ id: schema.factSets.id });
      if (!fs) throw new Error("ファクト一式の保存に失敗しました");
      for (const f of byName.values()) {
        await db.insert(schema.facts).values({
          factSetId: fs.id,
          facilityName: f.facilityName,
          status: f.status,
          price: f.price,
          startDate: f.startDate,
          endDate: f.endDate,
          excerpt: f.excerpt || null,
          reason: f.reason,
          snapshotId: dpaSnap.id,
        });
      }
      const all = [...byName.values()];
      return {
        ok: true as const,
        factSetId: fs.id,
        complete,
        motherCount: mother.length,
        eligible: all.filter((f) => f.status === "eligible").length,
        notEligible: all.filter((f) => f.status === "not_eligible").length,
        unknown: all.filter((f) => f.status === "unknown").length,
        rejected,
      };
    },
  }),

  saveCongestion: defineAction({
    description: "対象日の混雑予想（段階・根拠・材料）を保存し、日付ごとの再利用キャッシュにも残す。",
    request: z.object({
      setId: z.number().int().positive(),
      level: z.number().int().min(1).max(5),
      basis: z.string().min(1).max(2000),
      materials: z.array(z.string().max(300)).max(20),
      unavailable: z.array(z.string().max(300)).max(20),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const setRows = await db.select().from(schema.planSets).where(eq(schema.planSets.id, args.setId));
      const set = setRows[0];
      if (!set) throw new Error("セットが見つかりません");
      const cond = JSON.parse(set.conditionJson) as Condition;
      const materials = [...args.materials, ...args.unavailable.map((u) => `材料に使えなかった: ${u}`)];
      await db
        .insert(schema.congestionCache)
        .values({ park: cond.park, visitDate: cond.visitDate, level: args.level, basis: args.basis, materialsJson: JSON.stringify(materials) })
        .onConflictDoNothing();
      const cached = await db.select().from(schema.congestionCache).where(and(eq(schema.congestionCache.park, cond.park), eq(schema.congestionCache.visitDate, cond.visitDate)));
      const c0 = cached[0];
      const useLevel = c0 ? c0.level : args.level;
      const useBasis = c0 ? c0.basis : args.basis;
      const useMaterials = c0 ? (JSON.parse(c0.materialsJson) as string[]) : materials;
      await db.update(schema.planSets).set({ congestionJson: JSON.stringify({ level: useLevel, basis: useBasis, materials: useMaterials }) }).where(eq(schema.planSets.id, set.id));
      return { ok: true as const };
    },
  }),

  upsertFacility: defineAction({
    description: "辞書に無い新しい施設を登録する。座標は対象パークの範囲内のものだけを受け付ける（第4.1節）。",
    request: z.object({
      park: z.enum(["sea", "land"]),
      name: z.string().min(1).max(200),
      area: z.string().min(1).max(100),
      lat: z.number().nullable(),
      lng: z.number().nullable(),
      officialUrl: z.string().url().max(1000).nullable(),
      durationMin: z.number().int().min(0).nullable(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<{ ok: true }> {
      const range = args.park === "land" ? { latMin: 35.618, latMax: 35.652 } : { latMin: 35.608, latMax: 35.645 };
      let lat = args.lat;
      let lng = args.lng;
      if (lat != null && lng != null) {
        if (lat < range.latMin || lat > range.latMax || lng < 139.862 || lng > 139.902) {
          lat = null;
          lng = null; // 範囲外の座標は事実として保存しない（座標なし＝未確認として扱う）
        }
      }
      const db = ctx.db<typeof schema>();
      const existing = await db.select().from(schema.facilities).where(and(eq(schema.facilities.park, args.park), eq(schema.facilities.name, args.name)));
      if (existing.length === 0) {
        await db.insert(schema.facilities).values({ park: args.park, name: args.name, area: args.area, lat, lng, officialUrl: args.officialUrl, durationMin: args.durationMin });
      }
      return { ok: true as const };
    },
  }),

  submitPlans: defineAction({
    description: "生成タスクの提出口。第9節の検証を全て通過した場合のみ3プランを保存し、セットを完了にする。",
    request: z.object({
      setId: z.number().int().positive(),
      runId: z.number().int().positive(),
      factSetId: z.number().int().positive().nullable(),
      dayData: dayDataSchema,
      restaurantFacts: z.array(z.object({ name: z.string().max(200), kind: z.string().max(100), reservation: z.string().max(100), mobileOrder: z.string().max(100), excerpt: z.string().max(2000) })).max(30),
      plans: z.array(planSubmitSchema).length(3),
    }),
    response: z.object({ accepted: z.boolean(), errors: z.array(z.string()) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const setRows = await db.select().from(schema.planSets).where(eq(schema.planSets.id, args.setId));
      const set = setRows[0];
      if (!set) return { accepted: false, errors: ["セットが見つかりません"] };
      const cond = JSON.parse(set.conditionJson) as Condition;
      if (args.dayData.ticketChildPrices.length !== cond.children.length)
        return { accepted: false, errors: ["日付層データの子どもチケット単価の件数が、条件の子どもの人数と一致しません（条件対応の不一致）"] };
      const slots = args.plans.map((p) => p.slot).sort().join("");
      if (slots !== "ABC") return { accepted: false, errors: ["プランはA・B・Cの3つを提出してください"] };
      const fmap = await facilityMap(ctx, cond.park);
      const moves = await moveTable(ctx, cond.park);
      // 提出された行は時間順に並べ直してから検証・保存する（購入行は購入
      // 時刻の位置）。生成側の配列順に依存しないための機械的な正規化。
      const plans = args.plans.map((p) => ({ ...p, rows: sortRowsByTime(p.rows) }));
      const allErrors: string[] = [];
      const allUnconfirmed: string[] = [];
      const totals = new Map<string, { move: number; walk: number }>();
      for (const plan of plans) {
        const v = await validatePlan(ctx, cond, plan, args.factSetId, args.dayData, fmap, moves);
        allErrors.push(...v.errors);
        allUnconfirmed.push(...v.unconfirmed.map((u) => `プラン${plan.slot}: ${u}`));
        totals.set(plan.slot, { move: v.moveTotal, walk: v.walkTotal });
      }
      if (allErrors.length > 0) return { accepted: false, errors: allErrors };

      // 保存
      const existingPlans = await db.select().from(schema.plans).where(eq(schema.plans.setId, set.id));
      for (const ep of existingPlans) {
        await db.delete(schema.planRows).where(eq(schema.planRows.planId, ep.id));
        await db.delete(schema.plans).where(eq(schema.plans.id, ep.id));
      }
      for (const plan of plans) await persistPlan(ctx, set.id, plan, fmap);

      // 検証の記録（第9.3節）
      let factInfo: Record<string, unknown> = { factSetId: args.factSetId, complete: false };
      if (args.factSetId != null) {
        const fsRows = await db.select().from(schema.factSets).where(eq(schema.factSets.id, args.factSetId));
        const fs = fsRows[0];
        if (fs) {
          const fl = await db.select().from(schema.facts).where(eq(schema.facts.factSetId, fs.id));
          factInfo = {
            factSetId: fs.id,
            motherCount: fs.motherCount,
            complete: fs.complete === 1,
            eligible: fl.filter((f) => f.status === "eligible").length,
            notEligible: fl.filter((f) => f.status === "not_eligible").length,
            unknown: fl.filter((f) => f.status === "unknown").map((f) => ({ name: f.facilityName, reason: f.reason })),
            factsUsed: fl.map((f) => ({ name: f.facilityName, status: f.status, price: f.price, startDate: f.startDate, endDate: f.endDate, excerpt: f.excerpt })),
            periodExcluded: fl.filter((f) => f.status === "eligible" && ((f.startDate && cond.visitDate < f.startDate) || (f.endDate && cond.visitDate > f.endDate))).map((f) => ({ name: f.facilityName, startDate: f.startDate, endDate: f.endDate })),
          };
        }
      }
      const verification = {
        checkedAt: new Date().toISOString(),
        dayData: { openTime: args.dayData.openTime, closeTime: args.dayData.closeTime, closures: args.dayData.closures, showTimes: args.dayData.showTimes, ticketAdult: args.dayData.ticketAdult, ticketChildPrices: args.dayData.ticketChildPrices },
        factSet: factInfo,
        restaurantFacts: args.restaurantFacts,
        unconfirmed: allUnconfirmed,
        moveTotals: Object.fromEntries(totals),
      };
      const now = Date.now();
      await db.update(schema.planSets).set({ status: "complete", verificationJson: JSON.stringify(verification) }).where(eq(schema.planSets.id, set.id));
      await db.update(schema.runs).set({ status: "complete", finishedAt: now, lastProgressAt: now }).where(eq(schema.runs.id, args.runId));
      const hasUnknown = allUnconfirmed.length > 0;
      await db.insert(schema.messages).values({
        role: "assistant",
        text:
          `「${set.title}」の3プランが完成しました。プランセットのタブからご確認ください。` +
          (hasUnknown
            ? `\n\nなお、一部の項目は未確認のまま含まれています。このアプリの前提が、現在のディズニーの仕様と合わなくなっている可能性があります。直す場合は、Museのメインのチャットで「現在のディズニーの仕様に合わせて、このアプリを直してください」と伝えてください。`
            : ""),
        createdAt: now,
      });
      ctx.invalidateQueries();
      return { accepted: true, errors: [] };
    },
  }),

  submitReplacement: defineAction({
    description: "部分差し替えの提出口。対象プランだけを第9節の検証にかけて、同じセット内で置換する。",
    request: z.object({
      setId: z.number().int().positive(),
      runId: z.number().int().positive(),
      factSetId: z.number().int().positive().nullable(),
      dayData: dayDataSchema,
      restaurantFacts: z.array(z.object({ name: z.string().max(200), kind: z.string().max(100), reservation: z.string().max(100), mobileOrder: z.string().max(100), excerpt: z.string().max(2000) })).max(30),
      plan: planSubmitSchema,
    }),
    response: z.object({ accepted: z.boolean(), errors: z.array(z.string()) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const setRows = await db.select().from(schema.planSets).where(eq(schema.planSets.id, args.setId));
      const set = setRows[0];
      if (!set) return { accepted: false, errors: ["セットが見つかりません"] };
      const cond = JSON.parse(set.conditionJson) as Condition;
      const fmap = await facilityMap(ctx, cond.park);
      const moves = await moveTable(ctx, cond.park);
      // submitPlans と同じく、行は時間順に並べ直してから検証・保存する。
      const plan = { ...args.plan, rows: sortRowsByTime(args.plan.rows) };
      const v = await validatePlan(ctx, cond, plan, args.factSetId, args.dayData, fmap, moves);
      if (v.errors.length > 0) return { accepted: false, errors: v.errors };
      const existing = await db.select().from(schema.plans).where(and(eq(schema.plans.setId, set.id), eq(schema.plans.slot, args.plan.slot)));
      for (const ep of existing) {
        await db.delete(schema.planRows).where(eq(schema.planRows.planId, ep.id));
        await db.delete(schema.plans).where(eq(schema.plans.id, ep.id));
      }
      await persistPlan(ctx, set.id, plan, fmap);
      let verification: Record<string, unknown> = {};
      try {
        verification = set.verificationJson ? (JSON.parse(set.verificationJson) as Record<string, unknown>) : {};
      } catch {
        verification = {};
      }
      const replacements = Array.isArray(verification["replacements"]) ? (verification["replacements"] as unknown[]) : [];
      replacements.push({ slot: args.plan.slot, at: new Date().toISOString(), title: args.plan.title, unconfirmed: v.unconfirmed, restaurantFacts: args.restaurantFacts });
      verification["replacements"] = replacements;
      const now = Date.now();
      await db.update(schema.planSets).set({ status: "complete", verificationJson: JSON.stringify(verification) }).where(eq(schema.planSets.id, set.id));
      await db.update(schema.runs).set({ status: "complete", finishedAt: now, lastProgressAt: now }).where(eq(schema.runs.id, args.runId));
      await db.insert(schema.messages).values({
        role: "assistant",
        text: `「${set.title}」のプラン${args.plan.slot}を差し替えました。他のプランと、このセットの条件は変更していません。`,
        createdAt: now,
      });
      ctx.invalidateQueries();
      return { accepted: true, errors: [] };
    },
  }),

  failGeneration: defineAction({
    description: "生成タスクが失敗・無理の判定を報告する。セットを失敗として閉じ、チャットに理由つきで1回通知する。",
    request: z.object({
      setId: z.number().int().positive(),
      runId: z.number().int().positive(),
      reason: z.string().min(1).max(2000),
      impossibleCategory: z.string().max(200).nullable(),
      impossibleDetail: z.string().max(1000).nullable(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const now = Date.now();
      const setRows = await db.select().from(schema.planSets).where(eq(schema.planSets.id, args.setId));
      const set = setRows[0];
      await db.update(schema.planSets).set({ status: "failed" }).where(eq(schema.planSets.id, args.setId));
      await db.update(schema.runs).set({ status: "failed", finishedAt: now, lastProgressAt: now }).where(eq(schema.runs.id, args.runId));
      if (args.impossibleCategory) {
        await db.insert(schema.messages).values({
          role: "assistant",
          text: [
            `申し訳ありません。その条件ではプランを作成できませんでした。`,
            `原因：${args.impossibleCategory}${args.impossibleDetail ? `（${args.impossibleDetail}）` : ""}`,
            `最初は緩めの条件で作り、できたプランへ修正を重ねていく方が良いですよ。`,
          ].join("\n"),
          createdAt: now,
        });
      } else {
        await db.insert(schema.messages).values({
          role: "assistant",
          text: `「${set ? set.title : "プランセット"}」の作成に失敗しました。理由：${args.reason}\nプランセットのタブからリトライできます。`,
          createdAt: now,
        });
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  postTaskMessage: defineAction({
    description: "調査・参考サイト更新タスクが結果をチャットに投稿し、実行を閉じる。",
    request: z.object({ runId: z.number().int().positive(), text: z.string().min(1).max(8000), failed: z.boolean() }),
    response: okResponse,
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const now = Date.now();
      await db.insert(schema.messages).values({ role: "assistant", text: args.text, createdAt: now });
      await db.update(schema.runs).set({ status: args.failed ? "failed" : "complete", finishedAt: now, lastProgressAt: now }).where(eq(schema.runs.id, args.runId));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  applySiteUpdate: defineAction({
    description: "待ち時間参考サイトの追加・削除を行う（重複URLは登録しない）。",
    request: z.object({
      op: z.enum(["add", "remove"]),
      name: z.string().max(200),
      url: z.string().url().max(1000),
      park: z.enum(["sea", "land", "both"]),
      provides: z.string().max(2000),
    }),
    response: z.object({ ok: z.literal(true), applied: z.boolean() }),
    async handler(ctx, args): Promise<{ ok: true; applied: boolean }> {
      const db = ctx.db<typeof schema>();
      if (args.op === "add") {
        const existing = await db.select().from(schema.waitSites).where(eq(schema.waitSites.url, args.url));
        if (existing.length > 0) return { ok: true as const, applied: false };
        const all = await db.select().from(schema.waitSites);
        await db.insert(schema.waitSites).values({ name: args.name, url: args.url, park: args.park, provides: args.provides, sort: all.length });
        ctx.invalidateQueries();
        return { ok: true as const, applied: true };
      }
      const target = await db.select().from(schema.waitSites).where(eq(schema.waitSites.url, args.url));
      if (target.length === 0) return { ok: true as const, applied: false };
      await db.delete(schema.waitSites).where(eq(schema.waitSites.url, args.url));
      ctx.invalidateQueries();
      return { ok: true as const, applied: true };
    },
  }),

  retrySet: defineAction({
    description: "作成中・失敗したセットの生成を最初から再実行する（部分差し替えは対象プランだけ）。",
    request: z.object({ setId: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const setRows = await db.select().from(schema.planSets).where(eq(schema.planSets.id, args.setId));
      const set = setRows[0];
      if (!set) throw new Error("セットが見つかりません");
      const cond = JSON.parse(set.conditionJson) as Condition;
      const now = Date.now();
      const lines = parseProgress(set.progressJson);
      const replaceReq = [...lines].reverse().find((l) => l.kind === "replace_request");
      const runningRuns = await db.select().from(schema.runs).where(and(eq(schema.runs.setId, set.id), eq(schema.runs.status, "running")));
      for (const r of runningRuns) await db.update(schema.runs).set({ status: "failed", finishedAt: now }).where(eq(schema.runs.id, r.id));
      if (replaceReq && set.status !== "failed") {
        // 部分差し替えのリトライ
        await db.update(schema.planSets).set({ status: "creating", startedAt: now }).where(eq(schema.planSets.id, set.id));
        const [run] = await db.insert(schema.runs).values({ kind: "replace", setId: set.id, status: "running", startedAt: now, lastProgressAt: now, progressLabel: "差し替えの材料を、公式サイトで確認しています。" }).returning({ id: schema.runs.id });
        if (run) spawnGeneration(ctx, set.id, run.id, "replace", `部分差し替えのリトライ。対象スロット=${replaceReq.slot ?? ""}。利用者の指示: ${replaceReq.instruction ?? ""}。対象プランだけを作り直し submitReplacement で提出する。`);
      } else {
        const existingPlans = await db.select().from(schema.plans).where(eq(schema.plans.setId, set.id));
        for (const ep of existingPlans) {
          await db.delete(schema.planRows).where(eq(schema.planRows.planId, ep.id));
          await db.delete(schema.plans).where(eq(schema.plans.id, ep.id));
        }
        await db.update(schema.planSets).set({ status: "creating", startedAt: now, progressJson: JSON.stringify([{ at: now, text: "リトライを開始しました。", kind: "start" }]) }).where(eq(schema.planSets.id, set.id));
        const mode = set.origin === "rebuild" ? "rebuild" : "create";
        const [run] = await db.insert(schema.runs).values({ kind: mode, setId: set.id, status: "running", startedAt: now, lastProgressAt: now, progressLabel: "その日の情報を、公式サイトで確認しています。" }).returning({ id: schema.runs.id });
        if (run) spawnGeneration(ctx, set.id, run.id, mode, "リトライによる再実行。条件の控えは変更しない。");
      }
      void cond;
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  cancelSet: defineAction({
    description: "作成中の生成を取り消す。新規・作り直しはセットを削除し、部分差し替えは元のプランに戻す。",
    request: z.object({ setId: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const now = Date.now();
      const setRows = await db.select().from(schema.planSets).where(eq(schema.planSets.id, args.setId));
      const set = setRows[0];
      if (!set) throw new Error("セットが見つかりません");
      const runningRuns = await db.select().from(schema.runs).where(and(eq(schema.runs.setId, set.id), eq(schema.runs.status, "running")));
      const isReplace = runningRuns.some((r) => r.kind === "replace");
      for (const r of runningRuns) await db.update(schema.runs).set({ status: "failed", finishedAt: now }).where(eq(schema.runs.id, r.id));
      if (isReplace) {
        await db.update(schema.planSets).set({ status: "complete", startedAt: null }).where(eq(schema.planSets.id, set.id));
        await db.insert(schema.messages).values({ role: "assistant", text: `「${set.title}」の差し替えを取り消しました。プランは差し替え前の状態に戻っています。`, createdAt: now });
      } else {
        const planList = await db.select().from(schema.plans).where(eq(schema.plans.setId, set.id));
        for (const p of planList) {
          await db.delete(schema.planRows).where(eq(schema.planRows.planId, p.id));
          await db.delete(schema.plans).where(eq(schema.plans.id, p.id));
        }
        await db.delete(schema.planSets).where(eq(schema.planSets.id, set.id));
        await db.insert(schema.messages).values({ role: "assistant", text: `「${set.title}」の作成を取り消しました。`, createdAt: now });
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deletePlanSet: defineAction({
    description: "プランセットタブを削除する（プランと行も含む）。",
    request: z.object({ setId: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      const planList = await db.select().from(schema.plans).where(eq(schema.plans.setId, args.setId));
      for (const p of planList) {
        await db.delete(schema.planRows).where(eq(schema.planRows.planId, p.id));
        await db.delete(schema.plans).where(eq(schema.plans.id, p.id));
      }
      await db.delete(schema.planSets).where(eq(schema.planSets.id, args.setId));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  resetAllData: defineAction({
    description: "全ての利用者データを消して初期状態に戻す（辞書・移動時間・参考サイトの初期データは保持）。",
    request: z.object({}),
    response: okResponse,
    async handler(ctx): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.messages);
      await db.delete(schema.savedConditions);
      await db.delete(schema.planRows);
      await db.delete(schema.plans);
      await db.delete(schema.planSets);
      await db.delete(schema.facts);
      await db.delete(schema.factSets);
      await db.delete(schema.snapshots);
      await db.delete(schema.congestionCache);
      await db.delete(schema.runs);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),
} satisfies ActionsModule;
