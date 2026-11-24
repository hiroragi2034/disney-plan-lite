DROP TABLE entries
--> statement-breakpoint
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
)
--> statement-breakpoint
CREATE TABLE saved_conditions (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  park TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  entry_time TEXT,
  exit_time TEXT,
  budget INTEGER NOT NULL,
  adults INTEGER NOT NULL,
  children_json TEXT NOT NULL DEFAULT '[]',
  priority TEXT NOT NULL DEFAULT '',
  walk_speed INTEGER NOT NULL DEFAULT 70
)
--> statement-breakpoint
CREATE TABLE facilities (
  park TEXT NOT NULL,
  name TEXT NOT NULL,
  area TEXT NOT NULL,
  lat REAL,
  lng REAL,
  official_url TEXT,
  duration_min INTEGER,
  PRIMARY KEY (park, name)
)
--> statement-breakpoint
CREATE TABLE area_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  park TEXT NOT NULL,
  area_a TEXT NOT NULL,
  area_b TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  source TEXT NOT NULL
)
--> statement-breakpoint
CREATE TABLE wait_sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  park TEXT NOT NULL,
  provides TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
)
--> statement-breakpoint
CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  park TEXT NOT NULL,
  target_date TEXT,
  url TEXT NOT NULL,
  body TEXT NOT NULL,
  fetch_method TEXT NOT NULL,
  is_canon INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)
--> statement-breakpoint
CREATE TABLE fact_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id INTEGER,
  park TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  complete INTEGER NOT NULL DEFAULT 0,
  mother_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)
--> statement-breakpoint
CREATE TABLE facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_set_id INTEGER NOT NULL,
  facility_name TEXT NOT NULL,
  status TEXT NOT NULL,
  price INTEGER,
  start_date TEXT,
  end_date TEXT,
  excerpt TEXT,
  reason TEXT,
  snapshot_id INTEGER
)
--> statement-breakpoint
CREATE TABLE congestion_cache (
  park TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  level INTEGER NOT NULL,
  basis TEXT NOT NULL,
  materials_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (park, visit_date)
)
--> statement-breakpoint
CREATE TABLE plan_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'creating',
  origin TEXT NOT NULL DEFAULT 'form',
  origin_set_id INTEGER,
  condition_json TEXT NOT NULL,
  congestion_json TEXT,
  verification_json TEXT,
  progress_json TEXT NOT NULL DEFAULT '[]',
  started_at INTEGER,
  created_at INTEGER NOT NULL
)
--> statement-breakpoint
CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id INTEGER NOT NULL,
  slot TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL DEFAULT 0,
  breakdown_json TEXT NOT NULL DEFAULT '{}',
  scenario TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
)
--> statement-breakpoint
CREATE TABLE plan_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  ord INTEGER NOT NULL,
  kind TEXT NOT NULL,
  facility_name TEXT NOT NULL DEFAULT '',
  start_time TEXT,
  wait_minutes INTEGER,
  purchase_time TEXT,
  price INTEGER,
  target_count INTEGER,
  note TEXT NOT NULL DEFAULT '',
  uncertain INTEGER NOT NULL DEFAULT 0,
  uncertain_reason TEXT,
  official_url TEXT
)
--> statement-breakpoint
CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  set_id INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  started_at INTEGER NOT NULL,
  last_progress_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  progress_label TEXT NOT NULL DEFAULT '',
  finished_at INTEGER
)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ヴェネツィアン・ゴンドラ', 'メディテレーニアンハーバー', 35.626147, 139.8879186, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/230/', 12)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'スパークリング・ジュビリー・セレブレーション', 'メディテレーニアンハーバー', 35.6264517, 139.8869221, 'https://www.tokyodisneyresort.jp/tds/show/detail/7404/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ソアリン：ファンタスティック・フライト', 'メディテレーニアンハーバー', 35.627691, 139.885425, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/219/', 5)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ディズニー・クリスマス・グリーティング', 'メディテレーニアンハーバー', 35.6264517, 139.8869221, 'https://www.tokyodisneyresort.jp/tds/show/detail/953/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'カフェ・ポルトフィーノ', 'メディテレーニアンハーバー', 35.6270253, 139.8870537, 'https://www.tokyodisneyresort.jp/tds/restaurant/detail/400/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'タートル・トーク', 'アメリカンウォーターフロント', 35.623324, 139.887468, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/246/', 30)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'トイ・ストーリー・マニア！', 'アメリカンウォーターフロント', 35.624583, 139.88912, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/218/', 7)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'タワー・オブ・テラー', 'アメリカンウォーターフロント', 35.624096, 139.888268, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/243/', 2)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ニューヨーク・デリ', 'アメリカンウォーターフロント', 35.6253888, 139.8878656, 'https://www.tokyodisneyresort.jp/tds/restaurant/detail/422/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ビリーヴ！～シー・オブ・ドリームス～', 'メディテレーニアンハーバー', 35.6264517, 139.8869221, 'https://www.tokyodisneyresort.jp/tds/show/detail/967/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'スターブライト・クリスマス', 'パークワイド', 35.6264517, 139.8869221, 'https://www.tokyodisneyresort.jp/tds/show/detail/952/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'エンポーリオ', 'メディテレーニアンハーバー', 35.626882, 139.887937, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'アナとエルサのフローズンジャーニー', 'ファンタジースプリングス', 35.629945, 139.877251, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/255/', 7)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ラプンツェルのランタンフェスティバル', 'ファンタジースプリングス', 35.628984, 139.879654, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/256/', 5)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'フェアリー・ティンカーベルのビジーバギー', 'ファンタジースプリングス', 35.628281, 139.877928, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/258/', 2)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'アレンデール・ロイヤルバンケット', 'ファンタジースプリングス', 35.629413, 139.878062, 'https://www.tokyodisneyresort.jp/tds/restaurant/detail/409/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'センター・オブ・ジ・アース', 'ミステリアスアイランド', 35.6262272, 139.8845498, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/223/', 3)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', '海底2万マイル', 'ミステリアスアイランド', 35.626961, 139.884472, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/224/', 5)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'シンドバッド・ストーリーブック・ヴォヤッジ', 'アラビアンコースト', 35.62875, 139.881621, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/235/', 10)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'マジックランプシアター', 'アラビアンコースト', 35.6285626, 139.883104, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/226/', 23)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'カスバ・フードコート', 'アラビアンコースト', 35.628461, 139.882695, 'https://www.tokyodisneyresort.jp/tds/restaurant/detail/463/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ニモ＆フレンズ・シーライダー', 'ポートディスカバリー', 35.6249184, 139.8825063, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/247/', 5)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'リストランテ・ディ・カナレット', 'メディテレーニアンハーバー', 35.625687, 139.887773, 'https://www.tokyodisneyresort.jp/tds/restaurant/detail/408/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ダンス・ザ・グローブ！', 'アメリカンウォーターフロント', 35.624423, 139.887676, 'https://www.tokyodisneyresort.jp/tds/show/detail/7604/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ケープコッド・クックオフ', 'アメリカンウォーターフロント', 35.624612, 139.885083, 'https://www.tokyodisneyresort.jp/tds/restaurant/detail/446/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', '【環境演出】スパークリング・ジュビリー・ナイト', 'メディテレーニアンハーバー', 35.6264517, 139.8869221, 'https://www.tokyodisneyresort.jp/tds/show/detail/7405/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ピーターパンのネバーランドアドベンチャー', 'ファンタジースプリングス', 35.627859, 139.8789337, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/257/', 6)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ジャンピン・ジェリーフィッシュ', 'マーメイドラグーン', 35.6264458, 139.8833143, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/239/', 1)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ジャスミンのフライングカーペット', 'アラビアンコースト', 35.6283524, 139.8810948, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/220/', 2)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'インディ・ジョーンズ・アドベンチャー：クリスタルスカルの魔宮', 'ロストリバーデルタ', 35.6267129, 139.8806129, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/222/', 3)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'レイジングスピリッツ', 'ロストリバーデルタ', 35.6277111, 139.8807931, 'https://www.tokyodisneyresort.jp/tds/attraction/detail/242/', 2)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'スカイ・フル・オブ・カラーズ', 'パークワイド', 35.6264517, 139.8869221, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ニューデイ、ニュードリームス', 'パークワイド', 35.6264517, 139.8869221, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'スナグリーダックリング', 'ファンタジースプリングス', 35.6291282, 139.8786303, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ルックアウト・クックアウト', 'ファンタジースプリングス', 35.6281697, 139.8782511, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ファンタジースプリングス・ギフト', 'ファンタジースプリングス', 35.6282401, 139.8770569, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ケープコッド・クックオフ（ショーダイニングエリア）', 'アメリカンウォーターフロント', 35.624612, 139.885083, 'https://www.tokyodisneyresort.jp/tds/restaurant/detail/447/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', '美女と野獣“魔法のものがたり”', 'ファンタジーランド', 35.6304511, 139.8778894, 'https://www.tokyodisneyresort.jp/tdl/attraction/detail/197/', 8)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'イッツ・ア・スモールワールド', 'ファンタジーランド', 35.6304467, 139.8812413, 'https://www.tokyodisneyresort.jp/tdl/attraction/detail/172/', 10)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'プーさんのハニーハント', 'ファンタジーランド', 35.6302111, 139.8805376, 'https://www.tokyodisneyresort.jp/tdl/attraction/detail/174/', 5)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', '空飛ぶダンボ', 'ファンタジーランド', 35.6314631, 139.8816938, 'https://www.tokyodisneyresort.jp/tdl/attraction/detail/169/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'アリスのティーパーティー', 'ファンタジーランド', 35.6311492, 139.8809805, 'https://www.tokyodisneyresort.jp/tdl/attraction/detail/173/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'ベイマックスのハッピーライド', 'トゥモローランド', 35.6317007, 139.8788382, 'https://www.tokyodisneyresort.jp/tdl/attraction/detail/196/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'カリブの海賊', 'アドベンチャーランド', 35.6347638, 139.8813485, 'https://www.tokyodisneyresort.jp/tdl/attraction/detail/152/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'クイーン・オブ・ハートのバンケットホール', 'ファンタジーランド', 35.6309372, 139.8814195, 'https://www.tokyodisneyresort.jp/tdl/restaurant/detail/349/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'ミッキーのフィルハーマジック', 'ファンタジーランド', 35.6314952, 139.8806414, 'https://www.tokyodisneyresort.jp/tdl/attraction/detail/167/', 16)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'プラザパビリオン・レストラン', 'ウエスタンランド', 35.6328582, 139.8815443, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'カントリーベア・シアター', 'ウエスタンランド', 35.6325284, 139.8824532, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'カフェ・オーリンズ', 'アドベンチャーランド', 35.6342023, 139.8811664, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'イーストサイド・カフェ', 'ワールドバザール', 35.6345587, 139.8801459, 'https://www.tokyodisneyresort.jp/tdl/restaurant/detail/300/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'ザ・ダイヤモンドホースシュー', 'ウエスタンランド', 35.6326333, 139.8816527, 'https://www.tokyodisneyresort.jp/tdl/restaurant/detail/336/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'ウエスタンリバー鉄道', 'アドベンチャーランド', 35.6332414, 139.8854715, 'https://www.tokyodisneyresort.jp/tdl/attraction/detail/154/', 15)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'オムニバス', 'ワールドバザール', 35.6330125, 139.8796956, 'https://www.tokyodisneyresort.jp/tdl/attraction/detail/151/', 6)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'ミッキーの家とミート・ミッキー', 'トゥーンタウン', 35.6302495, 139.8785992, 'https://www.tokyodisneyresort.jp/tdl/greeting/detail/909/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'キャプテンフックス・ギャレー', 'ファンタジーランド', 35.6319879, 139.8820402, 'https://www.tokyodisneyresort.jp/tdl/restaurant/detail/346/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ディズニーシー・エレクトリックレールウェイ（ポートディスカバリー）', 'ポートディスカバリー', 35.6250071, 139.8856057, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ドリームス・テイク・フライト', 'ロストリバーデルタ', 35.6257667, 139.8825777, 'https://www.tokyodisneyresort.jp/tds/show/detail/7602/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'モンスターズ・インク“ライド＆ゴーシーク！”', 'トゥモローランド', 35.6339596, 139.8783588, 'https://www.tokyodisneyresort.jp/tdl/attraction/detail/189/', 4)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'キャッスルカルーセル', 'ファンタジーランド', 35.6313864, 139.881256, 'https://www.tokyodisneyresort.jp/tdl/attraction/detail/170/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'ミニー＠ファンダーランド', 'パークワイド', 35.6343228, 139.8795861, 'https://www.tokyodisneyresort.jp/en/tdl/show/detail/897/', 40)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'トイズ・ワンダラス・クリスマス！', 'パークワイド', 35.6343228, 139.8795861, 'https://www.tokyodisneyresort.jp/tdl/show/schedule/7003/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'ディズニー・ハーモニー・イン・カラー', 'パークワイド', 35.6343228, 139.8795861, 'https://www.tokyodisneyresort.jp/tdl/show/schedule/7000/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'ミッキーのマジカルミュージックワールド', 'ファンタジーランド', 35.6313055, 139.8773417, 'https://www.tokyodisneyresort.jp/tdl/show/schedule/895/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', '東京ディズニーランド・エレクトリカルパレード・ドリームライツ', 'パークワイド', 35.6343228, 139.8795861, 'https://www.tokyodisneyresort.jp/tdl/show/schedule/913/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'スターブライト・クリスマス', 'パークワイド', 35.6343228, 139.8795861, 'https://www.tokyodisneyresort.jp/tdl/show/schedule/951/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'ピーターパン空の旅', 'ファンタジーランド', 35.6319367, 139.8817773, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'ジャンボリミッキー！レッツ・ダンス！', 'アドベンチャーランド', 35.634254, 139.8817086, 'https://www.tokyodisneyresort.jp/tdl/show/schedule/985/', NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'センターストリート・コーヒーハウス', 'ワールドバザール', 35.6342033, 139.8791317, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'ホーンテッドマンション', 'ファンタジーランド', 35.6305519, 139.8821407, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'ジャングルクルーズ：ワイルドライフ・エクスペディション', 'アドベンチャーランド', 35.6339528, 139.8824076, 'https://www.tokyodisneyresort.jp/tdl/attraction/detail/153/', 10)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', '魅惑のチキルーム：スティッチ・プレゼンツ“アロハ・エ・コモ・マイ！”', 'アドベンチャーランド', 35.6331122, 139.882374, 'https://www.tokyodisneyresort.jp/tdl/attraction/detail/156/', 10)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ハンガーステージ', 'ロストリバーデルタ', 35.6257667, 139.8825777, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('sea', 'ウォーターフロントパーク', 'アメリカンウォーターフロント', 35.6244229, 139.8876761, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'ファンタジーランド・フォレストシアター', 'ファンタジーランド', 35.6313055, 139.8773417, NULL, NULL)
--> statement-breakpoint
INSERT INTO facilities (park, name, area, lat, lng, official_url, duration_min) VALUES ('land', 'シアターオーリンズ', 'アドベンチャーランド', 35.634254, 139.8817086, NULL, NULL)
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'ポートディスカバリー', 'メディテレーニアンハーバー', 5, 'マゼランズからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BMH0523）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'マーメイドラグーン', 'メディテレーニアンハーバー', 6, 'マゼランズからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BMH0523）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'アラビアンコースト', 'メディテレーニアンハーバー', 8, 'マゼランズからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BMH0523）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'メディテレーニアンハーバー', 'ロストリバーデルタ', 8, 'マゼランズからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BMH0523）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'アメリカンウォーターフロント', 'マーメイドラグーン', 12, 'ビッグシティ・ヴィークルからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BAW0103）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'アメリカンウォーターフロント', 'ロストリバーデルタ', 12, 'ビッグシティ・ヴィークルからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BAW0103）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'マーメイドラグーン', 'ミステリアスアイランド', 6, 'センター・オブ・ジ・アースからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BMI0101）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'ポートディスカバリー', 'ミステリアスアイランド', 6, 'センター・オブ・ジ・アースからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BMI0101）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'アラビアンコースト', 'ミステリアスアイランド', 7, 'センター・オブ・ジ・アースからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BMI0101）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'ミステリアスアイランド', 'ロストリバーデルタ', 7, 'センター・オブ・ジ・アースからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BMI0101）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'ポートディスカバリー', 'ロストリバーデルタ', 5, 'アクアトピアからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BPD0102）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'アラビアンコースト', 'ポートディスカバリー', 8, 'アクアトピアからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BPD0102）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'ポートディスカバリー', 'マーメイドラグーン', 9, 'アクアトピアからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BPD0102）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'アラビアンコースト', 'ロストリバーデルタ', 3, 'インディ・ジョーンズ・アドベンチャーからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BLD0101）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'マーメイドラグーン', 'ロストリバーデルタ', 5, 'インディ・ジョーンズ・アドベンチャーからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BLD0101）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'アラビアンコースト', 'マーメイドラグーン', 6, 'シンドバッド・ストーリーブック・ヴォヤッジからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=BAC0102）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('sea', 'アメリカンウォーターフロント', 'ファンタジースプリングス', 21, '東京ディズニーシーを「端から端まで」歩いたら……　かかった“驚きの時間”に「家から駅までとあまり変わらない……？」（1/2） | ディズニー ねとらぼ（https://nlab.itmedia.co.jp/cont/articles/3588963/amp/）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('land', 'トゥモローランド', 'ワールドバザール', 3, 'オムニバスからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=AWB0103）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('land', 'アドベンチャーランド', 'ワールドバザール', 2, 'オムニバスからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=AWB0103）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('land', 'ウエスタンランド', 'ワールドバザール', 5, 'オムニバスからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=AWB0103）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('land', 'ファンタジーランド', 'ワールドバザール', 4, 'オムニバスからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=AWB0103）')
--> statement-breakpoint
INSERT INTO area_moves (park, area_a, area_b, minutes, source) VALUES ('land', 'クリッターカントリー', 'ワールドバザール', 6, 'オムニバスからの移動時間、距離、歩数（ディズニー歩数）（https://disney.hosuu.jp/syosai_information.php?code=AWB0103）')
--> statement-breakpoint
INSERT INTO wait_sites (name, url, park, provides, sort) VALUES ('urtrip（ランド）', 'https://urtrip.jp/tdl-attraction-waitingtime-data/', 'land', 'アトラクション別の過去データ分析：平均・最大・最小の待ち時間と、日ごとの平均待ち時間の推移', 0)
--> statement-breakpoint
INSERT INTO wait_sites (name, url, park, provides, sort) VALUES ('urtrip（シー）', 'https://urtrip.jp/tds-attraction-waitingtime-data/', 'sea', 'アトラクション別の過去データ分析：平均・最大・最小の待ち時間と、日ごとの平均待ち時間の推移', 1)
--> statement-breakpoint
INSERT INTO wait_sites (name, url, park, provides, sort) VALUES ('テマパ！', 'https://www.temapa.jp/park/tdr/facility/258/', 'both', '施設ごとの現在の待ち時間と、平均・最大の待ち時間（リンク先は施設別ページの一例）', 2)
--> statement-breakpoint
INSERT INTO wait_sites (name, url, park, provides, sort) VALUES ('disneyreal（ファンタジースプリングス）', 'https://disneyreal.asumirai.info/guide/fantasysprings.html', 'sea', 'ファンタジースプリングスの待ち時間統計：平均・中央値・最小・最大', 3)
--> statement-breakpoint
INSERT INTO wait_sites (name, url, park, provides, sort) VALUES ('queue-times.com（シー）', 'https://queue-times.com/parks/275/stats', 'sea', '掲示待ち時間のリアルタイム値と、パークごと・日ごとの履歴統計（全ライドの平均待ち時間／平均最大待ち時間）。全期間平均は現在の水準より低めに出るため、プラン作成時の推定には直近の期間の数字を使うこと。ランド版（parks/274）も同じサイトにある', 4)
--> statement-breakpoint
INSERT INTO wait_sites (name, url, park, provides, sort) VALUES ('RopeDrop Planner', 'https://ropedropplanner.com/ja/tdr/wait-times', 'both', 'ランド・シー両パークの現在の待ち時間と30日平均。過去統計と天気予報などを組み合わせた予測寄りのサイト（公式ではない独立系）', 5)
