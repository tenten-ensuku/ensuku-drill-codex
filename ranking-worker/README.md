# エンスクドリル ランキングAPI

GitHub Pagesの画面と端末内保存はそのまま、ランキングだけを専用Worker + D1で扱います。他アプリ・Sites・旧Supabaseデータは対象外です。

- 公開アプリ: https://tenten-ensuku.github.io/ensuku-drill-codex/
- API: https://ensuku-drill-ranking-api.naga-study.workers.dev
- Worker: `ensuku-drill-ranking-api`
- D1: `ensuku-drill-rankings`
- API版: 169。画面のVER表示は非表示のままです。
- DBのIDは公開可能な識別子です。APIトークン・利用者データ・バックアップは公開しません。

## API

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `/health` | API版の確認。DB動作の確認にはランキング取得も必要 |
| GET | `/v1/rankings?mode=6&period=all` | 最大20名のランキング |
| GET | `/v1/position?mode=6&period=all&name=...` | 名前ごとの順位。認証やアカウント照合ではない |
| POST | `/v1/scores?start=...` | 完走結果を保存し、当日の順位を返す |

`mode`: `6 / 7 / 10_20 / 10_all`、`period`: `daily / last7 / last30 / all`。
`all`以外ではUTC ISO形式の`start`を指定します。今日の区切りは従来どおり**閲覧端末のローカル午前0時**です。7日・30日は端末で`setDate()`した日時です。カレンダー週・月には変更していません。サーバーで形式と妥当な時刻範囲を検証するため、端末時計が大きくずれているとエラーになります。

POSTはJSON形式、`Content-Type: application/json`と64桁hexの`Idempotency-Key`が必須です。同じ完走結果は同じキーで再送します。アプリは端末ID・完走時刻・モードからキーを生成します。新規投稿日時はサーバー時刻です。本文に投稿日時・管理フラグは受け付けません。

`src/ranking.mjs`の`validateScore`が入力仕様です。得点は既存の採点式と照合し、モード・完走問題数・タイム・名前等を検証します。問題や採点ロジックは変更しません。神の基準等を今後変更する場合、アプリとAPIの閾値を同時に更新し、整合テストを実行してください。

## 維持した仕様

- 得点降順、所要時間昇順、投稿日時昇順。これらが全て一致するときのみIDで順序を固定します。
- 得点と0.1秒単位の時間が等しい場合は同順位。次順位は飛ばします（1位、1位、3位）。
- 元のAPIと同じく、**上位500投稿を取得してから名前を集約し、上位20名を表示**します。自分の順位もこの500投稿が対象で、対象外は`null`です。
- 名前の空白整理、9 UTF-16文字分での集約、英字大小文字の同一視、4つの除外名を維持します。旧レコードの元の名前は書き換えません。
- 表裏は同じモードのランキングに入ります。GAME OVER・練習の投稿は受け付けません。
- 元の15項目を保持し、名前キー・時刻の数値・非表示フラグ・再送キー等だけを追加しています。
- 端末内の保存キー、履歴、設定、バックアップ形式、公開URLは変更しません。

## 制限と保護

- 本文は最大4KB、ランキング応答は最大20名。D1にはバインド変数付きSQLのみを使います。
- EdgeのIP単位上限は240回/分。共有回線を考慮した緩い上限です。
- 新規書き込みは端末ごと10回/60秒。Edgeに加えD1内の原子的なチェックで移動窓の上限を守ります。成功済みの再送は追加書き込みしません。
- 再送キーが同じで内容が異なる場合は409。保存済みなら、後続の順位取得に失敗しても`accepted: true`を返します。
- 旧保存先で投稿を禁止した端末は、非公開のハッシュ一覧に移しています。端末IDやIPを公開応答・アプリログに出しません。
- CORSは公開GitHub PagesのOriginのみ許可。**CORS・端末ID・名前は本人認証ではなく、完全なチート防止にはなりません。**
- 端末IDを変更した投稿や分散アクセスまで完全には防げません。大量の不正利用には追加の制限・対策判断が必要です。
- 一覧だけ最大15秒のエッジキャッシュを使います。ローリング期間のキーも15秒幅で共有します。投稿直後の順位・自分の順位・試験データはキャッシュしません。
- API障害で問題演習・採点・端末内保存を止めません。待ち時間は12秒で打ち切り、利用者が安全に再送できます。

## 開発・公開

Node 24以降。Windowsでは`npm.cmd`を使います。

```powershell
cd ranking-worker
npm.cmd ci
npm.cmd test
npm.cmd exec -- wrangler deploy --dry-run
npm.cmd run db:migrate
npm.cmd run deploy
```

このリポジトリはPagesが`main`のルートを公開します。**バックアップやトークンを配下に置かないでください。** Git除外だけに頼らず、元から別の非公開フォルダへ出力します。

最初にWorker/D1の本番試験を行い、その後アプリの接続先・バージョン・告知を更新してcommit/pushします。HTMLの200応答だけで完了にせず、本番の投稿と閲覧を再確認します。無料枠や課金プランは勝手に変更しません。

## データ移行の照合

今回の元データは3,641件。ID・日時を含む15項目の全件比較と、1,968通りの過去のモード別・期間別順位比較が一致しました。除外名の7件も原本どおり保持し、表示だけ除外します。今後の検証結果・元データ・ハッシュ詳細は非公開の移行記録に保存します。

```powershell
node scripts/prepare-import.mjs $sourceJson $schemaAudit $privateImportSql
node scripts/verify-migration.mjs $sourceJson $privateD1Export $privateReport
```

移行直前は旧`public.ensuku_rankings`のanon/authenticatedへのINSERT権限だけを取り消し、全件チェックサムを再確認します。旧タブの投稿は成功させず、再読み込みで新APIへ移ります。旧表の行、他の表、他アプリの権限は変更しません。切替前の完走結果は端末内に残りますが、自動再投稿はしません。

## 本番検証

`PROBE_TOKEN`をWorkerのsecretと非公開ローカルファイルにのみ保存します。試験リクエストにだけ`Authorization: Bearer ...`を付けると、同じPOST/GET処理で`is_test = 1`の隔離データを使用します。公開ランキングは常に`is_test = 0`で、クエリやJSONで試験・管理フラグを指定することはできません。トークンなしで試験データを取得するAPIはありません。

```powershell
node scripts/smoke-api.mjs $apiUrl $privateProbeSecret $privateReport
# Playwrightのインストール済みパスを環境変数に指定することもできます。
$env:PLAYWRIGHT_MODULE = 'path-to-playwright'
node test/browser-smoke.cjs --secret $privateProbeSecret --output $privateOutput
node test/browser-smoke.cjs --live --secret $privateProbeSecret --output $privateLiveOutput
```

Chromiumの375px/320pxタッチ端末設定と1280px PCを検証します。実機iPhone/Safariの保証とは分けて扱います。実際のAPI成功、応答消失後の再送、連投、表裏完走、履歴、設定、復習、問題一覧、分析、API停止中の演習継続、Supabase通信ゼロを確認します。

## 容量・運用

2026年9月10日確認の無料枠: D1は1DB 500MB・アカウント合計5GB・読み取り500万行/日・書き込み10万行/日。Workersは10万リクエスト/日。D1の行数課金には索引・走査行も含むので、レスポンス件数だけでは判断しません。

移行直後は約1.52MB。初回移行は読み取り7,282行・書き込み21,848行でした。新規投稿は複数の索引を更新するため、1投稿を1行書き込みとは数えません。日別/並び順/端末の索引と短時間キャッシュを使い、定期全件取得はしません。

六枚形・歴代の実測は、キャッシュなし1回につき候補500件・読み取り500行・書き込み0行でした。集約はWorkerで行います。期間指定時の走査量や投稿直後の順位照会は別途加算されるため、「1日1万閲覧まで必ず大丈夫」とは解釈しないでください。

Cloudflareの対象WorkerのMetricsとD1のMetricsで、リクエスト・CPU・rows_read・rows_written・容量を既存の容量確認時に一緒に見ます。重複する定期監視は追加していません。利用者数だけで余裕を保証せず、公開後の実測を見て調整してください。

公式情報: [D1料金](https://developers.cloudflare.com/d1/platform/pricing/)、[D1上限](https://developers.cloudflare.com/d1/platform/limits/)、[Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)。料金変更・アップグレードは管理者の別途承認が必要です。

## バックアップと切り戻し

専用D1を独立した非公開ローカルフォルダへ完全エクスポートします。`--table`付きのエクスポートでは索引が含まれなかったため、復旧用には全DBエクスポートを使います。出力に表示される一時ダウンロードURLも共有しません。

```powershell
npm.cmd exec -- wrangler d1 export ensuku-drill-rankings --remote --output $privateBackupSql -y
```

削除や切り戻し前には**D1の新規投稿も含めた最新バックアップ**を必ず取ります。D1のTime Travelだけに依存せず、別の安全な保管先にも非公開コピーを保管してください。自動定期バックアップは今回追加していません。

1. まず問題演習を残して投稿だけを停止するか、D1を残したまま動作確認済みWorker版へ戻します。
2. DBを古い状態へ上書きしないでください。新しい投稿を含む完全エクスポートとID一覧を保全します。
3. Supabaseが402の間、URLだけ戻しても復旧しません。復旧済みのことと元表の最新状態を管理経由で確認します。
4. Supabaseに戻す必要がある場合は、D1から新しいIDの成績を管理経由で移し、ID・日時・件数・内容を照合します。元データとの重複はIDで防ぎます。試験行は対象外です。
5. 両保存先への同時投稿を防ぎ、切替後の新API側への投稿停止も確認してから、必要な旧INSERT権限を復元します。
6. 最後にブラウザで投稿・閲覧を確認し、停止告知を解除します。旧Supabase原本は今回削除しません。
