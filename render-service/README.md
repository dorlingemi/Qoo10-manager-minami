# Qoo10 Render Service

GASの `UrlFetchApp` は Qoo10 のbot対策（Cloudflare等のWAF）にブロックされるため、
実ブラウザ（Playwright）でページをレンダリングしてから最終HTMLを返すマイクロサービス。

## なぜ必要か

- Qoo10は非ブラウザからのリクエストを検知・遮断する
- GASにはブラウザがなく、JS実行・Cookie同意・Lazy Loadへの対応ができない
- このサービスがCloud Run上で実ブラウザを起動し、人間が見るのと同じ最終状態のHTMLを返す
- GASはQoo10へ直接アクセスせず、必ずこのサービス経由でデータを取得する

## デプロイ手順（Google Cloud Run）

前提: `gcloud` CLIがインストール済み、GCPプロジェクトが作成済みであること。

```bash
cd render-service

# 1. APIキーを決める（推測されにくいランダム文字列。GASのConfig.gsと一致させる）
export API_KEY="$(openssl rand -hex 24)"
echo "API_KEY=$API_KEY"   # この値をメモしておく

# 2. Cloud Runにデプロイ（ソースから直接ビルド）
gcloud run deploy qoo10-render-service \
  --source . \
  --region asia-northeast1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 120 \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 3 \
  --allow-unauthenticated \
  --set-env-vars API_KEY="$API_KEY"

# 3. デプロイ完了後に表示されるService URLをメモする
#    例: https://qoo10-render-service-xxxxxxxx-an.a.run.app
```

- `--concurrency 1`: 1インスタンスにつき1リクエストずつ処理する（Playwrightはブラウザ1つにつき1セッションが安定するため）
- `--allow-unauthenticated`: 誰でもURLにアクセス可能になるため、`API_KEY` による認証を必須にしている。**API_KEYは外部に漏らさないこと**
- 料金: リクエストが来ない間は `min-instances 0` でスケールゼロ。GASからのアクセス時のみ起動・課金される

## GAS側の設定

`Config.gs` の以下を、デプロイ結果に合わせて書き換える:

```javascript
RENDER: {
  SERVICE_URL: 'https://qoo10-render-service-xxxxxxxx-an.a.run.app/render',
  API_KEY:     '上で生成したAPI_KEYと同じ値',
  WAIT_MS:     1500,
  TIMEOUT_MS:  60000,
},
```

## 動作確認

```bash
curl -X POST "$SERVICE_URL/render" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"url": "https://www.qoo10.jp/s/つけまつげ?keyword=つけまつげ&keyword_auto_change="}'
```

`html` フィールドに実際の検索結果ページHTMLが返ってくれば成功。
これを使って `src/Parser.gs` の `parseSearchResults` / `parseProduct` の正規表現パターンを
実際のHTML構造に合わせて修正する。

## ローカル動作確認（デプロイ前）

```bash
npm install
API_KEY=test PORT=8080 node server.js

# 別ターミナルで
curl -X POST http://localhost:8080/render \
  -H "Content-Type: application/json" \
  -H "x-api-key: test" \
  -d '{"url": "https://www.qoo10.jp/s/つけまつげ?keyword=つけまつげ&keyword_auto_change="}'
```

## DISMISS_SELECTORS の調整について

`server.js` 内の `DISMISS_SELECTORS` はCookie同意・広告ポップアップを閉じるための
セレクタ一覧だが、現時点ではQoo10の実DOMを確認せずに一般的な候補を列挙した推測値。
実際にレンダリング結果を確認しながら、必要なセレクタを追加・修正すること。
