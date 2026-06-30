/**
 * Config.gs — 全局配置（所有参数集中管理，禁止在其他文件硬编码）
 */

var CONFIG = {

  // ── Sheet名称 ──────────────────────────────────────────
  SHEET: {
    INPUT:       'Input',        // 输入：URL / 关键词
    PRODUCTS:    'Products',     // 商品主表
    COMPETITORS: 'Competitors',  // 竞争商品表
    ANALYSIS:    'Analysis',     // 竞品对比分析表
    DASHBOARD:   'Dashboard',    // 仪表板
    LOG:         'Log',          // 错误日志
  },

  // ── 爬取参数 ──────────────────────────────────────────
  CRAWL: {
    BASE_URL:            'https://www.qoo10.jp',
    // 実ブラウザで確認済み: https://www.qoo10.jp/s/{keyword}?keyword={keyword}&keyword_auto_change=
    SEARCH_URL:          'https://www.qoo10.jp/s/',
    PRODUCT_URL_PREFIX:  'https://www.qoo10.jp/g/',
    // ⚠️ GASは1回の実行が6分（無料Googleアカウント）または30分（Workspace）で
    // 強制終了される。Render無料層は1商品あたりのレンダリングに約90-100秒かかるため
    // （リソース制限によるものと推測。有料プランへのアップグレードで改善が期待できる）、
    // 6分制限内に収まるよう保守的に2件に設定。増やす場合は実行環境のプラン・時間制限を確認すること。
    MAX_COMPETITORS:     2,       // 每次最多采集竞争商品数
    SEARCH_PAGE:         1,       // 搜索起始页
    REQUEST_DELAY_MS:    2000,    // 每次请求间隔（毫秒）
    RETRY_COUNT:         3,       // 失败重试次数
    RETRY_DELAY_MS:      5000,    // 重试间隔（毫秒）
    TIMEOUT_MS:          30000,   // 单次请求超时
    USER_AGENT:          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },

  // ── レンダリングサービス（Cloud Run + Playwright） ──────
  // Qoo10はbot対策（Cloudflare等）でGASからの直接アクセスをブロックするため、
  // 実ブラウザでレンダリングするマイクロサービス経由でHTMLを取得する。
  // render-service/ をCloud Runにデプロイし、そのURLとAPIキーをここに設定する。
  RENDER: {
    SERVICE_URL: 'https://YOUR-CLOUD-RUN-SERVICE-XXXXX.a.run.app/render',  // ← デプロイ後に書き換える
    API_KEY:     'YOUR_API_KEY_HERE',  // ← Cloud Runの環境変数 API_KEY と同じ値
    WAIT_MS:     1500,    // ページ最終待機時間（Ajax遅延対策）
    TIMEOUT_MS:  60000,   // レンダリングは直接取得より時間がかかるため長めに設定
  },

  // ── Qoo10公式API（QSM/QAPI、自社店舗データ専用） ─────────
  // 自社が運営するQoo10店舗の商品・売上・在庫データを取得するための公式API設定。
  // 競合他社の商品は公式APIで取得できない（自社店舗管理用のため）。競合データは引き続き RENDER 経由で取得する。
  // ⚠️ GiosisCertificationKeyは機密情報。このファイルをバージョン管理にコミットする場合は
  //    別途 PropertiesService 等での管理に切り替えることを推奨する。
  OFFICIAL_API: {
    ENABLED:        false,  // 公式APIを使う場合のみ true にする
    BASE_URL:       'https://api.qoo10.jp/GMKT.INC.Front.QAPIService/ebayjapan.qapi/',
    SAK:            'YOUR_GIOSIS_CERTIFICATION_KEY',  // ← GASエディタで直接書き換える。チャット等に貼らないこと
    QAPI_VERSION:   '1.0',
    SALES_LOOKBACK_DAYS: 90,  // 出荷実績から販売数を集計する対象期間（日）
  },

  // ── 市场规模估算パラメータ（Qoo10 University準拠） ──────
  MARKET: {
    REVIEW_RATE:          0.30,   // レビュー率（購入者のうちレビューを書く割合）← 要調整可
    RECENT_MONTHS:        3,      // 直近X月の売上を推計
    FORECAST_MONTHS:      [1, 3, 6, 12],  // 予測期間（月）
    MIN_SALES_FOR_TREND:  5,      // トレンド計算に必要な最低販売数
  },

  // ── 競争力スコアリング重み ───────────────────────────
  SCORE_WEIGHTS: {
    price:       0.20,
    review:      0.20,
    sales:       0.20,
    search:      0.15,
    image:       0.10,
    description: 0.05,
    delivery:    0.05,
    store:       0.05,
  },

  // ── 画像評価基準 ──────────────────────────────────────
  IMAGE: {
    IDEAL_COUNT:     8,    // 理想的な画像枚数
    MIN_COUNT:       3,    // 最低限必要な画像枚数
    HAS_VIDEO_BONUS: 10,   // 動画あり場合のボーナスポイント
  },

  // ── 配送評価基準 ──────────────────────────────────────
  DELIVERY: {
    FREE_THRESHOLD:  0,    // 送料無料判定（0=無料）
    FAST_DAYS:       3,    // 「早い」と判定する配送日数
    SLOW_DAYS:       7,    // 「遅い」と判定する配送日数
  },

  // ── Triggerスケジュール ───────────────────────────────
  TRIGGER: {
    DAILY_HOUR:    3,      // 毎日何時に自動実行するか（0-23）
    WEEKLY_DAY:    1,      // 週次Trigger：曜日（1=月曜）
  },

  // ── ログ設定 ──────────────────────────────────────────
  LOG: {
    MAX_ROWS:      1000,   // Logシートの最大行数
    LEVEL: {
      DEBUG: 0,
      INFO:  1,
      WARN:  2,
      ERROR: 3,
    },
    CURRENT_LEVEL: 1,      // 出力するログレベル（0=DEBUG, 1=INFO ...）
  },

};
