# Qoo10竞品分析系统 — セットアップガイド

## アーキテクチャ概要

```
┌─────────────┐    own (自社商品)    ┌──────────────────┐
│             │ ───────────────────▶│ OfficialApi.gs    │──▶ Qoo10公式API (QSM/QAPI)
│  GAS        │                      │ （自社データのみ） │    自社店舗の商品・売上を取得
│  (Main.gs)  │                      └──────────────────┘
│             │   url / keyword      ┌──────────────────┐
│             │ ───────────────────▶│ Crawler.gs        │──▶ render-service (Cloud Run)
└─────────────┘                      │ （競合データ）     │    ヘッドレスブラウザで実際に
                                      └──────────────────┘    Qoo10ページをレンダリング
```

**なぜ2系統あるか**: Qoo10公式API（QSM/QAPI）は販売者自身の店舗管理専用で、
競合他社の商品データは取得できない。一方Qoo10サイトはbot対策（Cloudflare等）で
GASからの直接アクセスをブロックするため、競合データはヘッドレスブラウザ経由の
中継サービス（render-service）を別途用意している。

## ファイル構成

```
src/
  Config.gs       — 全パラメータ（ここだけ変更すればOK）
  AppLogger.gs    — ログ管理
  Crawler.gs      — render-service経由のHTTP取得（競合データ用）
  Parser.gs       — HTML解析（実HTML構造で検証済み: 検索結果ページ）
  OfficialApi.gs  — Qoo10公式API連携（自社データ用）
  Calculator.gs   — 売上推計・スコア計算（Qoo10大学準拠）
  Analyzer.gs     — 競品分析・比較表生成
  SheetWriter.gs  — Sheets書き込み
  Dashboard.gs    — ダッシュボード生成
  Trigger.gs      — 定期実行設定
  Main.gs         — エントリポイント・UIメニュー
appsscript.json   — GASマニフェスト

render-service/   — Cloud Run用ヘッドレスブラウザサービス（別途デプロイ要）
  server.js       — Playwrightレンダリングサーバー
  Dockerfile
  README.md       — デプロイ手順
```

## デプロイ手順

### 1. render-serviceをCloud Runにデプロイする

`render-service/README.md` の手順に従ってデプロイし、Service URLとAPI_KEYを控える。

### 2. GASプロジェクトを構築する

1. Google スプレッドシートを新規作成する
2. メニュー「拡張機能」→「Apps Script」を開く
3. 左サイドバーの「+ファイル」で各 `.gs` ファイルを作成し、内容をコピー&ペーストする
   - ファイル名は拡張子 `.gs` を除いた名前にする
   - 作成順序: Config → AppLogger → Crawler → Parser → OfficialApi → Calculator → Analyzer → SheetWriter → Dashboard → Trigger → Main
4. `appsscript.json` の内容を「プロジェクトの設定」→「appsscript.json ファイルをエディタで表示する」にコピーする
5. `Config.gs` を開き、以下を実際の値に書き換える：
   - `RENDER.SERVICE_URL` / `RENDER.API_KEY` ← Cloud Runデプロイ結果
   - `OFFICIAL_API.ENABLED = true`、`OFFICIAL_API.SAK` ← Qoo10 Developer画面の Certification Key
     （**この値はGASエディタ上で直接入力すること。チャットや外部に貼らないこと**）
6. GASエディタの関数選択で `onOpen` を選び「実行」する（初回は権限認証が必要）
7. スプレッドシートに戻ると「🔍 Qoo10分析」メニューが追加されている

### 3. デバッグ実行で動作確認する

- `debugTestSearchFetch` — render-service経由でQoo10検索結果が取得できるか確認
- `debugTestOfficialApi('自社の商品コード')` — 公式APIのレスポンス構造を確認
  （`OfficialApi.gs` のフィールドマッピングは未検証の推測値のため、実行結果のLogシートに出る
  `raw` フィールドを見ながら `_mapItemDetail` / `_mapSellingReport` を実データに合わせて調整する）

## 使い方

### 手動実行
1. メニュー「🔍 Qoo10分析」→「📋 Inputシートを初期化」でInputシートを作成
2. Inputシートに分析したい対象を入力

| A列 (タイプ) | B列 (入力値) | 取得元 |
|-------------|------------|--------|
| own | 1234567890（自社商品コード） | 公式API |
| url | https://www.qoo10.jp/g/XXXXXX | render-service |
| keyword | フライパン | render-service |

3. メニュー「▶ 分析実行（全入力）」を実行

### 自動実行
- メニュー「⏰ 自動実行Triggerを設定」→ 毎日 `Config.gs` の `TRIGGER.DAILY_HOUR` 時に自動実行

## 主要パラメータ（Config.gs）

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| `MARKET.REVIEW_RATE` | 0.30 | レビュー率（Qoo10大学推奨値） |
| `MARKET.RECENT_MONTHS` | 3 | 直近何ヶ月で市場規模を推計するか |
| `CRAWL.MAX_COMPETITORS` | 20 | 1キーワードあたりの最大競合取得数 |
| `CRAWL.REQUEST_DELAY_MS` | 2000 | リクエスト間隔（ms）※短すぎるとBANリスク |
| `RENDER.SERVICE_URL` | （要設定） | render-serviceのCloud Run URL |
| `OFFICIAL_API.ENABLED` | false | 公式APIで自社データを取得するか |
| `OFFICIAL_API.SAK` | （要設定） | Giosis Certification Key |
| `TRIGGER.DAILY_HOUR` | 3 | 自動実行時間（0-23） |

## 生成されるシート

| シート名 | 内容 |
|---------|------|
| Input | 自社商品コード・URL・キーワード入力 |
| Products | 商品データ（全項目） |
| Competitors | 競合商品データ |
| Analysis | Qoo10大学Checklist準拠の比較表 |
| Dashboard | 市場概況・ランキング・価格分布 |
| Log | エラー・実行ログ |

## 売上推計ロジック（Qoo10大学準拠、競合商品向け）

```
直近3ヶ月販売推計数 = 直近3ヶ月レビュー数推計 ÷ レビュー率(30%)
直近3ヶ月売上推計  = 直近3ヶ月販売推計数 × 現在の販売価格
```

出典: https://article-university.qoo10.jp/entry/132

自社商品については推計せず、公式APIの `GetSellingReportDetailList` から実績値を直接取得する。

## 注意事項

- `Parser.gs` の検索結果解析（`parseSearchResults`）は実際のQoo10 HTML構造で検証済み。
  ただし商品詳細ページ（`parseProduct`）側は未検証の推測パターンのため、実データで要確認・調整。
- `OfficialApi.gs` のレスポンスフィールド名は公式ドキュメント非公開のため推測。
  `debugTestOfficialApi` の実行結果を見ながら調整すること。
- Qoo10のHTML構造変更で `Parser.gs` の正規表現が壊れる可能性がある。その場合は `_extract` パターンのみ修正する。
- 短時間での大量リクエストはrender-service経由でもブロックされるリスクがある。
  `CONFIG.CRAWL.REQUEST_DELAY_MS` を 2000ms 以上に設定すること。
- **Certification Key（SAK）やrender-serviceのAPI_KEYは機密情報。チャットや外部に貼らないこと。**
  漏洩した場合はQoo10 Developer画面の「再発行」、Cloud Runの環境変数更新で速やかに無効化する。
