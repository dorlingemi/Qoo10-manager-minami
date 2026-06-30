/**
 * Main.gs — エントリポイント・UIメニュー
 *
 * ユーザーはこのファイルの関数のみを直接呼び出す。
 * 処理フロー：
 *   Inputシート → Crawler → Parser → Calculator → Analyzer → SheetWriter → Dashboard
 */

// ── スプレッドシート起動時にメニュー追加 ──────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔍 Qoo10分析')
    .addItem('▶ 分析実行（全入力）',      'runAll')
    .addSeparator()
    .addItem('📊 ダッシュボード更新',       'runDashboardOnly')
    .addSeparator()
    .addItem('⏰ 自動実行Triggerを設定',   'setupTriggers')
    .addItem('🗑 Triggerを削除',           'deleteTriggers')
    .addSeparator()
    .addItem('📋 Inputシートを初期化',     'initInputSheet')
    .addItem('📝 ログをクリア',            'clearLog')
    .addToUi();
}

// ── メイン実行関数 ─────────────────────────────────────────

/**
 * Inputシートの全エントリを処理する
 */
function runAll() {
  AppLogger.info('===== runAll 開始 =====');

  var inputs = SheetWriter.readInputs();
  if (!inputs.length) {
    AppLogger.warn('Inputシートに処理対象がありません');
    SpreadsheetApp.getUi().alert('Inputシートにデータを入力してください。\nA列: url または keyword\nB列: URLまたはキーワード');
    return;
  }

  inputs.forEach(function (input) {
    try {
      SheetWriter.markInputStatus(input.row, '処理中...');
      if (input.type === 'own') {
        _processOwnItem(input.value);
      } else if (input.type === 'url') {
        _processUrl(input.value);
      } else {
        _processKeyword(input.value);
      }
      SheetWriter.markInputStatus(input.row, '完了 ✓');
    } catch (e) {
      AppLogger.error('入力処理エラー: ' + input.value, e.message);
      SheetWriter.markInputStatus(input.row, 'エラー: ' + e.message);
    }
  });

  Dashboard.refresh();
  AppLogger.info('===== runAll 完了 =====');
  SpreadsheetApp.getActiveSpreadsheet().toast('分析完了！', 'Qoo10分析', 5);
}

/**
 * ダッシュボードのみ再生成する
 */
function runDashboardOnly() {
  Dashboard.refresh();
  SpreadsheetApp.getActiveSpreadsheet().toast('ダッシュボードを更新しました。', 'Qoo10分析', 3);
}

// ── 自社商品処理フロー（公式API） ────────────────────────

/**
 * 自社商品を1件処理する（Qoo10公式API経由、render-serviceは使わない）
 * Inputシートで type='own' / value=自社商品コード として指定する。
 * @param {string} itemCode
 */
function _processOwnItem(itemCode) {
  AppLogger.info('自社商品処理開始（公式API）', itemCode);

  if (!CONFIG.OFFICIAL_API.ENABLED) {
    AppLogger.error('CONFIG.OFFICIAL_API.ENABLED が false です。自社商品の取得には公式APIを有効化してください。', itemCode);
    return;
  }

  // Step1: 公式APIから自社商品データを取得（スクレイピングしない）
  var product = OfficialApi.getOwnProduct(itemCode);
  if (!product) { AppLogger.error('公式API取得失敗', itemCode); return; }

  AppLogger.info('自社商品取得完了: ' + product.title, product._salesReportNote);

  // Step3: キーワードで競合検索（競合は引き続きrender-service経由）
  var keyword      = _extractKeyword(product.title, product.category);
  var competitors  = _fetchCompetitors(keyword);

  // Step5-6: 分析
  var allProducts  = [product].concat(competitors.map(function (c) { return c.product; }));
  var analyzed     = Analyzer.analyzeProduct(product, 0, allProducts);

  // Step9: Sheetに書き込み
  SheetWriter.upsertProduct(product, analyzed, product.url);

  competitors.forEach(function (c) {
    var aComp = Analyzer.analyzeProduct(c.product, c.rank, allProducts);
    SheetWriter.writeCompetitor(keyword, c.rank, c.isSponsored, c.product, aComp);
  });

  var compAnalyzed = competitors.map(function (c) {
    return Analyzer.analyzeProduct(c.product, c.rank, allProducts);
  });
  var table = Analyzer.buildComparisonTable([analyzed].concat(compAnalyzed));
  SheetWriter.writeComparisonTable(keyword + '（自社商品: ' + itemCode + '）', table);

  AppLogger.info('自社商品処理完了', itemCode);
}

// ── URL処理フロー ─────────────────────────────────────────

/**
 * 商品URLを1件処理する
 * @param {string} url
 */
function _processUrl(url) {
  AppLogger.info('URL処理開始', url);

  // Step2: 商品ページ取得
  var html    = Crawler.fetchProduct(url);
  if (!html)  { AppLogger.error('HTML取得失敗', url); return; }

  // Step4: 商品情報解析
  var product = Parser.parseProduct(html, url);
  if (!product) { AppLogger.error('商品解析失敗', url); return; }

  AppLogger.info('商品解析完了: ' + product.title);

  // Step3: カテゴリ・キーワードで競合検索
  var keyword = _extractKeyword(product.title, product.category);
  var competitors = _fetchCompetitors(keyword);

  // Step5-6: 分析
  var allProducts = [product].concat(competitors.map(function (c) { return c.product; }));
  var analyzed    = Analyzer.analyzeProduct(product, 0, allProducts);

  // Step9: Sheetに書き込み
  SheetWriter.upsertProduct(product, analyzed, url);

  // 競合も書き込み
  competitors.forEach(function (c) {
    var aComp = Analyzer.analyzeProduct(c.product, c.rank, allProducts);
    SheetWriter.writeCompetitor(keyword, c.rank, c.isSponsored, c.product, aComp);
  });

  // 対比表
  var compAnalyzed = competitors.map(function (c) {
    return Analyzer.analyzeProduct(c.product, c.rank, allProducts);
  });
  var table = Analyzer.buildComparisonTable([analyzed].concat(compAnalyzed));
  SheetWriter.writeComparisonTable(keyword, table);

  AppLogger.info('URL処理完了', url);
}

// ── キーワード処理フロー ──────────────────────────────────

/**
 * 検索キーワードを1件処理する
 * @param {string} keyword
 */
function _processKeyword(keyword) {
  AppLogger.info('キーワード処理開始', keyword);

  // Step2-3: 検索実行
  var searchHtml = Crawler.fetchSearch(keyword, CONFIG.CRAWL.SEARCH_PAGE);
  if (!searchHtml) { AppLogger.error('検索HTML取得失敗', keyword); return; }

  var searchItems = Parser.parseSearchResults(searchHtml);
  AppLogger.info('検索結果: ' + searchItems.length + '件', keyword);

  var limit       = Math.min(searchItems.length, CONFIG.CRAWL.MAX_COMPETITORS);
  var allProducts = [];

  // Step4: 各商品の詳細を取得
  searchItems.slice(0, limit).forEach(function (item) {
    var html    = Crawler.fetchProduct(item.url);
    if (!html)  return;
    var product = Parser.parseProduct(html, item.url);
    if (!product) return;
    product.searchRank   = item.rank;
    product.isSponsored  = item.isSponsored;
    allProducts.push({ product: product, rank: item.rank, isSponsored: item.isSponsored });
  });

  if (!allProducts.length) {
    AppLogger.warn('商品詳細取得が0件', keyword);
    return;
  }

  var products = allProducts.map(function (a) { return a.product; });

  // Step5-6: 全商品を分析
  var analyzedList = allProducts.map(function (a) {
    return Analyzer.analyzeProduct(a.product, a.rank, products);
  });

  // Step9: 書き込み
  analyzedList.forEach(function (a, i) {
    SheetWriter.upsertProduct(a, a, keyword);
    SheetWriter.writeCompetitor(keyword, allProducts[i].rank, allProducts[i].isSponsored, a, a);
  });

  // 対比表
  var table = Analyzer.buildComparisonTable(analyzedList);
  SheetWriter.writeComparisonTable(keyword, table);

  AppLogger.info('キーワード処理完了: ' + allProducts.length + '件', keyword);
}

// ── 競合商品の取得 ────────────────────────────────────────

/**
 * 指定キーワードで競合商品を検索して詳細を取得する
 * @param {string} keyword
 * @returns {Array<{product, rank, isSponsored}>}
 */
function _fetchCompetitors(keyword) {
  var html  = Crawler.fetchSearch(keyword, 1);
  if (!html) return [];

  var items = Parser.parseSearchResults(html);
  var limit = Math.min(items.length, CONFIG.CRAWL.MAX_COMPETITORS);
  var result= [];

  items.slice(0, limit).forEach(function (item) {
    var pHtml   = Crawler.fetchProduct(item.url);
    if (!pHtml) return;
    var product = Parser.parseProduct(pHtml, item.url);
    if (!product) return;
    result.push({ product: product, rank: item.rank, isSponsored: item.isSponsored });
  });

  return result;
}

// ── ユーティリティ ────────────────────────────────────────

/**
 * 商品タイトルとカテゴリからメインキーワードを抽出する
 *
 * 品詞分解（形態素解析）はGAS標準では行えないため、
 * タイトル中の「最初に出現する日本語（ひらがな/カタカナ/漢字）の連続部分」を
 * メインキーワードとして採用する（推測ロジック）。
 * ローマ字のブランド名（例: "MENG JIE SHANG PIN"）は除外される。
 */
function _extractKeyword(title, category) {
  if (!title) return category || '';

  // [】「」()などの括弧と内容を除去（ブランドタグ・装飾表記を除外）
  var cleaned = title.replace(/[\[【(（][^\]】)）]*[\]】)）]/g, ' ').trim();

  // 日本語連続文字列（ひらがな/カタカナ/漢字、2文字以上）を抽出
  var jpMatches = cleaned.match(/[ぁ-んァ-ヶ一-龠]{2,}/g);

  if (jpMatches && jpMatches.length > 0) {
    // 最も長い日本語トークンを優先（一般的に商品種別名になりやすい）
    jpMatches.sort(function (a, b) { return b.length - a.length; });
    return jpMatches[0];
  }

  // 日本語が見つからない場合はカテゴリにフォールバック
  if (category) return category.split(/[>＞]/).pop().trim();

  return cleaned.slice(0, 16).trim();
}

// ── 初期化・メンテナンス ──────────────────────────────────

/**
 * Inputシートを初期化して入力例を表示する
 */
function initInputSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET.INPUT);
  if (sheet) ss.deleteSheet(sheet);

  sheet = ss.insertSheet(CONFIG.SHEET.INPUT);
  sheet.appendRow(['タイプ (own/url/keyword)', '入力値', '最終実行', 'ステータス']);
  sheet.appendRow(['own',     '1234567890', '', '']);   // 自社商品コード（公式API経由、ENABLED=true時のみ有効）
  sheet.appendRow(['url',     'https://www.qoo10.jp/g/12345678', '', '']);
  sheet.appendRow(['keyword', 'フライパン',  '', '']);
  sheet.appendRow(['keyword', '美容液',      '', '']);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#4A90D9').setFontColor('#FFFFFF');
  sheet.autoResizeColumns(1, 4);

  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
  SpreadsheetApp.getUi().alert(
    'Inputシートを初期化しました。\nA列にタイプ、B列に値を入力してください。\n' +
    '・own: 自社商品コード（公式API経由、Config.gsでOFFICIAL_API.ENABLED=trueが必要）\n' +
    '・url: Qoo10商品URL\n' +
    '・keyword: 検索キーワード'
  );
}

/**
 * デバッグ用：検索URLの生HTMLを取得してLogシートに最初の500文字を出力する
 * Qoo10のbot対策（Cloudflare等）でブロックされていないか確認する目的。
 *
 * ブロック判定は「cloudflare/captcha等の単語が含まれるか」ではなく
 * （Qoo10ページ自体にCookie同意文言等で誤検出するため）、
 * 実際に検証済みの商品行マーカー（ga-product="..."）が存在するかで行う。
 */
function debugTestSearchFetch() {
  var keyword = 'つけまつげ';
  var html    = Crawler.fetchSearch(keyword, 1);
  if (!html) {
    AppLogger.error('debugTestSearchFetch: フェッチ失敗（nullが返却された）', keyword);
    return;
  }
  var snippet = html.slice(0, 500).replace(/\n/g, ' ');
  AppLogger.info('debugTestSearchFetch 結果先頭500文字', snippet);

  var items = Parser.parseSearchResults(html);
  AppLogger.info('debugTestSearchFetch 商品抽出件数: ' + items.length, html.length + '文字取得');

  _safeAlert(
    items.length > 0
      ? '取得成功。商品 ' + items.length + ' 件を抽出しました。'
      : '⚠️ 商品が0件でした。ブロックされたかHTML構造が変わった可能性があります。Logシートを確認してください。'
  );
}

/**
 * デバッグ用：商品詳細ページの生HTMLをrender-service経由で取得し、
 * Parser.parseProduct() のフィールド抽出結果と、価格/レビュー/画像周辺の
 * 生HTML断片をLogシートに出力する。
 *
 * parseProduct() の正規表現パターンはまだ実HTML未検証（推測ベース）のため、
 * このデバッグ結果を見ながら Parser.gs の該当パターンを実データに合わせて調整する。
 *
 * @param {string} url  検証したいQoo10商品ページURL（例: https://www.qoo10.jp/g/1077983682）
 */
function debugTestProductFetch(url) {
  if (!url) {
    _safeAlert('debugTestProductFetch(url) に商品URLを渡して実行してください。');
    return;
  }

  var html = Crawler.fetchProduct(url);
  if (!html) {
    AppLogger.error('debugTestProductFetch: フェッチ失敗（nullが返却された）', url);
    return;
  }

  AppLogger.info('debugTestProductFetch 取得文字数: ' + html.length, url);

  var product = Parser.parseProduct(html, url);
  AppLogger.info('debugTestProductFetch parseProduct結果',
    JSON.stringify({
      title: product.title, brand: product.brand, shopName: product.shopName,
      salePrice: product.salePrice, originalPrice: product.originalPrice,
      reviewCount: product.reviewCount, reviewScore: product.reviewScore,
      totalSales: product.totalSales, imageCount: product.imageCount,
      isFreeShip: product.isFreeShip, category: product.category,
    }));

  // JSON-LD構造化データ（最も信頼できるデータ源。存在すれば丸ごと出力）
  var ldJsonBlocks = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (ldJsonBlocks) {
    ldJsonBlocks.forEach(function (block, i) {
      AppLogger.info('debugTestProductFetch JSON-LD[' + i + '] (1/2)', block.slice(0, 1500));
      if (block.length > 1500) {
        AppLogger.info('debugTestProductFetch JSON-LD[' + i + '] (2/2)', block.slice(1500, 3000));
      }
    });
  } else {
    AppLogger.info('debugTestProductFetch JSON-LD', '見つかりませんでした');
  }

  // 主要項目周辺の生HTML断片（パターン調整の手がかり用）
  // search()の最初のヒットだと無関係な箇所（検索履歴UI等）に当たるため、
  // より具体的なマーカーを使い、見つからない場合は全件のインデックスを試す。
  var priceMatches = _findAllIndexes(html, /[\d,]{3,}\s*円/g);
  priceMatches.slice(0, 3).forEach(function (idx, i) {
    AppLogger.info('debugTestProductFetch 価格候補HTML[' + i + ']', html.slice(Math.max(0, idx - 150), idx + 150));
  });

  // goodsDetailWrap（実際の商品詳細・カテゴリパネルの開始点。mshop_barの
  // 約15000文字後に存在することを確認済み）以降を大きめのチャンクで一括ダンプする。
  var detailIdx = html.indexOf('goodsDetailWrap');
  var detailTail = detailIdx >= 0 ? html.slice(detailIdx) : html.slice(html.indexOf('mshop_bar'));

  var CHUNK = 8000;
  for (var c = 0; c < 8; c++) {
    var chunkText = detailTail.slice(c * CHUNK, (c + 1) * CHUNK);
    if (!chunkText) break;
    AppLogger.info('debugTestProductFetch goodsDetailWrap以降[' + c + '] (' + (c * CHUNK) + '-' + ((c + 1) * CHUNK) + ')', chunkText);
  }

  _safeAlert('実行完了。Logシートで "debugTestProductFetch" 関連の行を確認してください。\n' +
    '特に JSON-LD が見つかっていればそれを最優先でParser.gsに反映します。');
}

/**
 * デバッグ用：debugTestProductFetch を固定URLで実行するためのラッパー。
 * GASエディタの関数選択ドロップダウンは引数なし関数しか直接実行できないため、
 * 検証したい商品URLをここに書き換えて実行する。
 */
function runDebugTestProductFetch() {
  debugTestProductFetch('https://www.qoo10.jp/g/1184922467');
}

/**
 * GASエディタから直接実行した場合（スプレッドシートのUIコンテキスト外）は
 * SpreadsheetApp.getUi() が例外を投げるため、それを握りつぶすラッパー。
 * デバッグ関数はLogシートへの出力が本体なので、アラート表示の失敗は無視してよい。
 */
function _safeAlert(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    AppLogger.info('_safeAlert: UIコンテキスト外のためアラート表示をスキップ', message.slice(0, 100));
  }
}

/** 正規表現に一致する全位置のindexを配列で返す（デバッグ用） */
function _findAllIndexes(text, regex) {
  var indexes = [];
  var match;
  while ((match = regex.exec(text)) !== null) {
    indexes.push(match.index);
    if (match.index === regex.lastIndex) regex.lastIndex++;  // ゼロ幅マッチ対策
  }
  return indexes;
}

/**
 * デバッグ用：公式API（GetItemDetailInfo）の生レスポンスをLogシートに出力する
 * OfficialApi.gs のフィールドマッピング（_mapItemDetail/_mapSellingReport）が
 * 実際のJSON構造と一致しているか検証する目的。
 *
 * 実行前に Config.gs の OFFICIAL_API.ENABLED=true, SAK=実際のCertification Key を
 * GASエディタ上で直接設定しておくこと（チャット等に貼らないこと）。
 *
 * 自社の実際の商品コードを引数に渡して実行する。
 */
function debugTestOfficialApi(itemCode) {
  if (!itemCode) {
    _safeAlert('debugTestOfficialApi(itemCode) に自社の商品コードを渡して実行してください。');
    return;
  }

  if (!CONFIG.OFFICIAL_API.ENABLED) {
    AppLogger.error('debugTestOfficialApi: OFFICIAL_API.ENABLED が false です', itemCode);
    _safeAlert('Config.gs の OFFICIAL_API.ENABLED を true にしてから再実行してください。');
    return;
  }

  var detail = OfficialApi.getItemDetail(itemCode);
  if (detail) {
    AppLogger.info('debugTestOfficialApi: GetItemDetailInfo マッピング結果',
      JSON.stringify({ title: detail.title, salePrice: detail.salePrice, raw: detail._raw }).slice(0, 1500));
  } else {
    AppLogger.error('debugTestOfficialApi: GetItemDetailInfo 取得失敗', itemCode);
  }

  var report = OfficialApi.getSellingReport(itemCode);
  AppLogger.info('debugTestOfficialApi: GetSellingReportDetailList 集計結果', JSON.stringify(report));

  _safeAlert('実行完了。Logシートで "debugTestOfficialApi" の行を確認してください。\n' +
    '特に "raw" フィールドに実際のJSON生データが入っているので、それを元にフィールド名を調整します。');
}

/**
 * Logシートをクリアする
 */
function clearLog() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET.LOG);
  if (!sheet) return;
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues();
  sheet.clearContents();
  sheet.getRange(1, 1, 1, header[0].length).setValues(header);
  AppLogger.info('ログをクリアしました');
}
