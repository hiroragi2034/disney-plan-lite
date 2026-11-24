import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  role: text("role").notNull(),
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const savedConditions = sqliteTable("saved_conditions", {
  id: integer("id").primaryKey(),
  park: text("park").notNull(),
  visitDate: text("visit_date").notNull(),
  entryTime: text("entry_time"),
  exitTime: text("exit_time"),
  budget: integer("budget").notNull(),
  adults: integer("adults").notNull(),
  childrenJson: text("children_json").notNull().default("[]"),
  priority: text("priority").notNull().default(""),
  walkSpeed: integer("walk_speed").notNull().default(70),
});

export const facilities = sqliteTable("facilities", {
  park: text("park").notNull(),
  name: text("name").notNull(),
  area: text("area").notNull(),
  lat: real("lat"),
  lng: real("lng"),
  officialUrl: text("official_url"),
  durationMin: integer("duration_min"),
});

export const areaMoves = sqliteTable("area_moves", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  park: text("park").notNull(),
  areaA: text("area_a").notNull(),
  areaB: text("area_b").notNull(),
  minutes: integer("minutes").notNull(),
  source: text("source").notNull(),
});

export const waitSites = sqliteTable("wait_sites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  park: text("park").notNull(),
  provides: text("provides").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const snapshots = sqliteTable("snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  park: text("park").notNull(),
  targetDate: text("target_date"),
  url: text("url").notNull(),
  body: text("body").notNull(),
  fetchMethod: text("fetch_method").notNull(),
  isCanon: integer("is_canon").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const factSets = sqliteTable("fact_sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  setId: integer("set_id"),
  park: text("park").notNull(),
  visitDate: text("visit_date").notNull(),
  complete: integer("complete").notNull().default(0),
  motherCount: integer("mother_count").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const facts = sqliteTable("facts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  factSetId: integer("fact_set_id").notNull(),
  facilityName: text("facility_name").notNull(),
  status: text("status").notNull(),
  price: integer("price"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  excerpt: text("excerpt"),
  reason: text("reason"),
  snapshotId: integer("snapshot_id"),
});

export const congestionCache = sqliteTable("congestion_cache", {
  park: text("park").notNull(),
  visitDate: text("visit_date").notNull(),
  level: integer("level").notNull(),
  basis: text("basis").notNull(),
  materialsJson: text("materials_json").notNull().default("[]"),
});

export const planSets = sqliteTable("plan_sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  status: text("status").notNull().default("creating"),
  origin: text("origin").notNull().default("form"),
  originSetId: integer("origin_set_id"),
  conditionJson: text("condition_json").notNull(),
  congestionJson: text("congestion_json"),
  verificationJson: text("verification_json"),
  progressJson: text("progress_json").notNull().default("[]"),
  startedAt: integer("started_at"),
  createdAt: integer("created_at").notNull(),
});

export const plans = sqliteTable("plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  setId: integer("set_id").notNull(),
  slot: text("slot").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  total: integer("total").notNull().default(0),
  breakdownJson: text("breakdown_json").notNull().default("{}"),
  scenario: text("scenario").notNull().default(""),
  notes: text("notes").notNull().default(""),
});

export const planRows = sqliteTable("plan_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  planId: integer("plan_id").notNull(),
  ord: integer("ord").notNull(),
  kind: text("kind").notNull(),
  facilityName: text("facility_name").notNull().default(""),
  startTime: text("start_time"),
  waitMinutes: integer("wait_minutes"),
  purchaseTime: text("purchase_time"),
  price: integer("price"),
  targetCount: integer("target_count"),
  note: text("note").notNull().default(""),
  uncertain: integer("uncertain").notNull().default(0),
  uncertainReason: text("uncertain_reason"),
  officialUrl: text("official_url"),
});

export const runs = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  setId: integer("set_id"),
  status: text("status").notNull().default("running"),
  startedAt: integer("started_at").notNull(),
  lastProgressAt: integer("last_progress_at").notNull(),
  attempts: integer("attempts").notNull().default(1),
  progressLabel: text("progress_label").notNull().default(""),
  finishedAt: integer("finished_at"),
});
