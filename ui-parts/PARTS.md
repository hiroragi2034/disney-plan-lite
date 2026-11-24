# 最小版 UIパーツ一覧

本家の画面側（`wo-gajia-nodeizuniji-hua/client/`）から切り出した部品。
各部品は本家のコードそのままで、最小版の範囲に合わせた削りだけを「削る所」に書く。
最小版への反映はこの部品単位で行い、反映後に部品単位で本家と比較する。

| 部品 | 本家の出どころ | 最小版の対応先 | 削る所 |
|---|---|---|---|
| 00-header.tsx | App.tsx 1–137行（import・型） | App.tsx冒頭 | 最小版に無い機能の型だけ削る |
| 00-helpers.tsx | App.tsx 138–278行 | App.tsx | なし |
| 01-theme.css | client/src/theme.css（225行） | client/src/theme.css | なし（そのまま一致させる） |
| 02-index.html | client/index.html（19行） | client/index.html | なし（そのまま一致させる） |
| 03-leaflet.css | client/src/leaflet.css（661行） | 地図のスタイル | 地図の実装方式に合わせて要否を決める |
| 04-map-helpers.mjs | client/src/map_helpers.mjs（846行） | client/src/map_helpers.mjs | 静止画フォールバック等、最小版で使う分だけ |
| 05-map.tsx | App.tsx 279–882行（PlanMap） | PlanSetViewの地図 | なし（行とピンの連動を含む） |
| 06-rows.tsx | App.tsx 883–1472行（RowList） | PlanSetViewの行一覧 | 施設写真の表示（最小版に写真は無い） |
| 07-progress.tsx | App.tsx 1473–1760行 | PlanSetViewの作成中表示 | なし |
| 08-set-conditions.tsx | App.tsx 1761–2009行 | PlanSetViewの条件表示 | 当日検索に関する表示があれば削る |
| 09-plan-set-view.tsx | App.tsx 2010–3543行 | PlanSetView.tsx | PDFのボタンとプレビュー（最小版にPDFは無い） |
| 10-plan-summary.tsx | App.tsx 3953–4315行 | PlanSetViewの集計表示 | なし |
| 11-chat.tsx | App.tsx 4318–4516行（ChatView） | App.tsxのChatView | 当日検索の入口があれば削る |
| 12-conditions-form.tsx | App.tsx 4877–5270行（ConditionsView） | App.tsxの条件フォーム | 最小版の第3節にある項目だけにする |
| 13-wait-sources.tsx | App.tsx 5271–5403行 | App.tsxの参考サイト表示 | なし |
| 14-customize.tsx | App.tsx 5404–5603行 | App.tsxの「もっとこうして！」 | 最小版の第2節の案内に合わせる |
| 15-shell.tsx | App.tsx 6623–7332行（App・TabButton） | App.tsxの外枠とタブ帯 | デバッグ・タスク管理・当日検索のタブ |

対象外（本家だけの部分）：PDF一式（App.tsx 3544–3952行、pdf.ts）、当日検索（4517–4876行）、デバッグとタスク管理のタブ（5604–6622行）、plan_metrics.ts のうち最小版の表示に無いもの。

地図のライブラリ本体（hatch-maps.js）は自動で作られるファイルで本家と最小版で少し違うため、部品の対象にしない。部品は手書きの側だけ。
