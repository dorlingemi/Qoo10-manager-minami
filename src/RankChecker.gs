/**
 * RankChecker.gs — キーワード検索内での商品順位確認
 *
 * 指定キーワードで最大5ページ（100件）を検索し、
 * 対象商品（URL or 商品ID）が何位に出現するかを調べる。
 * 結果は RankCheck シートに追記する。
 */

var RankChecker = (function () {

  var MAX_PAGES   = 5;   // 最大ページ数（20件/ページ × 5 = 100件）
  var SHEET_NAME  = 'RankCheck';

  // ── 商品ID正規化 ─────────────────────────────────────────

  /**
   * URL or 商品IDから数値IDを抽出する
   * 例: https://www.qoo10.jp/g/1101789351 → '1101789351'
   *     https://www.qoo10.jp/item/xxx-xxx/G000000000 → 末尾数字
   */
  function _extractItemNo(input) {
    input = String(input || '').trim();
    // /g/数字 パターン
    var m = input.match(/\/g\/(\d+)/);
    if (m) return m[1];
    // /item/...G数字 パターン（楽天型URL等の念のため対応）
    m = input.match(/G(\d{8,})/i);
    if (m) return m[1];
    // 純粋な数字のみ
    if (/^\d+$/.test(input)) return input;
    return null;
  }

  // ── メイン検索ロジック ───────────────────────────────────

  /**
   * キーワード検索で対象商品の順位を探す
   * @param {string} keyword   検索キーワード
   * @param {string} target    商品URL または 商品ID
   * @returns {Object} result
   */
  function find(keyword, target) {
    var targetId = _extractItemNo(target);
    if (!targetId) {
      AppLogger.error('RankChecker: 商品IDを取得できませんでした', target);
      return { found: false, error: '商品IDを取得できませんでした: ' + target };
    }

    AppLogger.info('RankChecker: 検索開始', 'キーワード=' + keyword + ' / 対象ID=' + targetId);

    var globalRank = 0;  // スポンサー含む全体順位
    var organicRank = 0; // オーガニックのみの順位

    for (var page = 1; page <= MAX_PAGES; page++) {
      AppLogger.info('RankChecker: ページ取得中', page + '/' + MAX_PAGES + 'ページ');

      var html = Crawler.fetchSearch(keyword, page);
      if (!html) {
        AppLogger.error('RankChecker: HTML取得失敗', page + 'ページ目');
        break;
      }

      var items = Parser.parseSearchResults(html);
      if (!items.length) {
        AppLogger.info('RankChecker: 結果なし（最終ページ到達）', page + 'ページ目');
        break;
      }

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        globalRank++;
        if (!item.isSponsored) organicRank++;

        var itemId = _extractItemNo(item.url) || String(item.itemNo || '');
        if (itemId === targetId) {
          AppLogger.info('RankChecker: 発見！',
            '全体' + globalRank + '位 / オーガニック' + organicRank + '位 / ' + page + 'ページ目');
          return {
            found:        true,
            keyword:      keyword,
            targetId:     targetId,
            globalRank:   globalRank,
            organicRank:  item.isSponsored ? null : organicRank,
            isSponsored:  item.isSponsored,
            page:         page,
            title:        item.title,
            price:        item.price,
            reviewCount:  item.reviewCount,
            url:          item.url,
            checkedAt:    new Date(),
            totalScanned: globalRank,
          };
        }
      }

      // ページ間ウェイト（Renderへの連続リクエスト負荷軽減）
      if (page < MAX_PAGES) Utilities.sleep(CONFIG.CRAWL.REQUEST_DELAY_MS);
    }

    AppLogger.warn('RankChecker: 100位以内に見つかりませんでした',
      'キーワード=' + keyword + ' / ID=' + targetId);
    return {
      found:        false,
      keyword:      keyword,
      targetId:     targetId,
      globalRank:   null,
      totalScanned: globalRank,
      checkedAt:    new Date(),
    };
  }

  // ── シート出力 ───────────────────────────────────────────

  function _writeSheet(result) {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      var headers = [
        '確認日時', 'キーワード', '商品ID', '商品名',
        '全体順位', 'オーガニック順位', 'スポンサー',
        'ページ', '価格', 'レビュー数', 'URL', '備考',
      ];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight('bold')
        .setBackground('#1F3864')
        .setFontColor('#FFFFFF');
      sheet.setFrozenRows(1);
    }

    var row = [
      result.checkedAt,
      result.keyword,
      result.targetId,
      result.title        || '',
      result.globalRank   || '圏外(100位以下)',
      result.organicRank  || (result.isSponsored ? '広告' : '圏外'),
      result.isSponsored  ? '広告' : 'オーガニック',
      result.page         || '',
      result.price        || '',
      result.reviewCount  || '',
      result.url          || '',
      result.found ? '' : '100位以内に未検出（' + result.totalScanned + '件スキャン済）',
    ];

    sheet.appendRow(row);
    sheet.autoResizeColumns(1, row.length);
  }

  // ── 公開エントリポイント ─────────────────────────────────

  /**
   * 順位確認を実行してシートに記録する
   * @param {string} keyword
   * @param {string} target  URL or 商品ID
   */
  function check(keyword, target) {
    var result = find(keyword, target);
    _writeSheet(result);

    var msg = result.found
      ? '【' + keyword + '】全体' + result.globalRank + '位 / ' +
        (result.isSponsored ? '広告枠' : 'オーガニック' + result.organicRank + '位') +
        '（' + result.page + 'ページ目）'
      : '【' + keyword + '】100位以内に見つかりませんでした';

    SpreadsheetApp.getActiveSpreadsheet().toast(msg, '順位確認結果', 8);
    return result;
  }

  return { check: check, find: find };

})();
