/**
 * KeywordSuggest.gs — Qoo10検索補完キーワード取得モジュール
 *
 * render-serviceの /autocomplete エンドポイントを通じて
 * Qoo10の検索補完候補を取得し、各候補をKeywordValue.check()で評価する。
 *
 * 出力シート: KeywordSuggest（毎回上書き）
 */

var KeywordSuggest = (function () {

  var SHEET_NAME = 'KeywordSuggest';

  // ── 補完候補の取得 ─────────────────────────────────────────

  /**
   * render-serviceの /autocomplete を呼んでQoo10の補完候補を返す
   * @param {string} keyword  入力語（例: "まつげ"）
   * @returns {string[]} suggestions
   */
  function _fetchSuggestions(keyword) {
    var cfg = CONFIG.RENDER;
    if (!cfg.SERVICE_URL || !cfg.API_KEY) {
      AppLogger.error('KeywordSuggest: RENDER設定が未設定');
      return [];
    }

    // SERVICE_URL が /render で終わっている場合は除去してベースURLを取得
    var baseUrl = cfg.SERVICE_URL.replace(/\/render\/?$/, '').replace(/\/$/, '');
    var url     = baseUrl + '/autocomplete';
    var payload = JSON.stringify({ keyword: keyword });

    try {
      var resp = UrlFetchApp.fetch(url, {
        method:             'post',
        contentType:        'application/json',
        payload:            payload,
        headers:            { 'x-api-key': cfg.API_KEY },
        muteHttpExceptions: true,
        followRedirects:    true,
      });

      var code = resp.getResponseCode();
      if (code !== 200) {
        AppLogger.error('KeywordSuggest: HTTP ' + code, resp.getContentText().slice(0, 200));
        return [];
      }

      var data = JSON.parse(resp.getContentText());
      return Array.isArray(data.suggestions) ? data.suggestions : [];

    } catch (e) {
      AppLogger.error('KeywordSuggest: 通信エラー', e.message);
      return [];
    }
  }

  // ── シート出力 ───────────────────────────────────────────

  function _writeSheet(baseKeyword, results) {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
    }

    sheet.clearContents();
    sheet.clearFormats();
    sheet.setColumnWidth(1, 200);
    sheet.setColumnWidth(2, 80);
    sheet.setColumnWidth(3, 80);
    sheet.setColumnWidth(4, 80);
    sheet.setColumnWidth(5, 80);
    sheet.setColumnWidth(6, 80);
    sheet.setColumnWidth(7, 180);

    // タイトル行
    sheet.getRange(1, 1, 1, 7).merge()
      .setValue('補完キーワード 購買価値レポート — 入力: 「' + baseKeyword + '」')
      .setFontSize(13).setFontWeight('bold')
      .setBackground('#1F3864').setFontColor('#FFFFFF')
      .setHorizontalAlignment('center');
    sheet.setRowHeight(1, 40);

    // ヘッダー行
    var headers = [
      '補完キーワード', '購買価値\nスコア', '広告率\n(%)', '上位平均\nレビュー',
      '推定月間\n市場規模(円)', '結果件数', '判定',
    ];
    sheet.getRange(2, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold')
      .setBackground('#2E4057').setFontColor('#FFFFFF')
      .setWrap(true).setHorizontalAlignment('center');
    sheet.setRowHeight(2, 44);
    sheet.setFrozenRows(2);

    if (results.length === 0) {
      sheet.getRange(3, 1, 1, 7).merge()
        .setValue('補完候補が取得できませんでした')
        .setFontColor('#999999').setHorizontalAlignment('center');
      ss.setActiveSheet(sheet);
      return;
    }

    // データ行
    var dataRows = results.map(function (r, i) {
      return [
        r.keyword,
        r.analyzed ? r.analyzed.valueScore : '—',
        r.analyzed ? r.analyzed.adRate + '%' : '—',
        r.analyzed ? r.analyzed.top5AvgReview : '—',
        r.analyzed ? '¥' + r.analyzed.estMonthlyMarket.toLocaleString() : '—',
        r.analyzed ? r.analyzed.totalResults : '—',
        r.analyzed ? r.analyzed.verdict : '（分析スキップ）',
      ];
    });

    sheet.getRange(3, 1, dataRows.length, 7).setValues(dataRows);

    // 色分け（スコア列 = B列）
    dataRows.forEach(function (row, i) {
      var rowNum = i + 3;
      var score  = typeof row[1] === 'number' ? row[1] : -1;
      var bg = score >= 75 ? '#C8E6C9'
             : score >= 55 ? '#FFF9C4'
             : score >= 35 ? '#FFE0B2'
             : '#FFCDD2';

      sheet.getRange(rowNum, 2).setBackground(bg).setHorizontalAlignment('center').setFontWeight('bold');
      sheet.getRange(rowNum, 1, 1, 7)
        .setBackground(i % 2 === 0 ? '#F5F8FF' : '#FFFFFF');
      sheet.getRange(rowNum, 2).setBackground(bg);  // スコアセルは上書き
      sheet.setRowHeight(rowNum, 28);
    });

    sheet.getRange(2, 1, dataRows.length + 1, 7)
      .setBorder(true, true, true, true, true, true, '#CCCCCC', SpreadsheetApp.BorderStyle.SOLID)
      .setVerticalAlignment('middle');

    ss.setActiveSheet(sheet);
  }

  // ── 公開エントリポイント ─────────────────────────────────

  /**
   * @param {string} baseKeyword  例: "まつげ"
   * @param {boolean} [analyzeAll=false]  trueにすると全候補をKeywordValue.check()で分析
   */
  function run(baseKeyword, analyzeAll) {
    AppLogger.info('KeywordSuggest: 開始', baseKeyword);

    var suggestions = _fetchSuggestions(baseKeyword);
    AppLogger.info('KeywordSuggest: 補完候補', suggestions.length + '件取得');

    if (suggestions.length === 0) {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        '補完候補が取得できませんでした。Qoo10サイトの構造が変わっている可能性があります。',
        'KeywordSuggest', 6
      );
      _writeSheet(baseKeyword, []);
      return;
    }

    // 各補完候補をKeywordValue._analyzeと同様に評価（分析する場合）
    var results = suggestions.map(function (kw, idx) {
      if (!analyzeAll) {
        return { keyword: kw, analyzed: null };
      }

      AppLogger.info('KeywordSuggest: 分析中 ' + (idx + 1) + '/' + suggestions.length, kw);
      try {
        var html  = Crawler.fetchSearch(kw, 1);
        if (!html) return { keyword: kw, analyzed: null };

        var items = Parser.parseSearchResults(html);
        if (!items.length) return { keyword: kw, analyzed: null };

        // KeywordValue内部の_analyzeと同等のロジックをここでも実行
        var total        = items.length;
        var sponsored    = items.filter(function (i) { return i.isSponsored; });
        var organic      = items.filter(function (i) { return !i.isSponsored; });
        var top5Organic  = organic.slice(0, 5);
        var adRate       = Math.round((sponsored.length / total) * 100);
        var top5Reviews  = top5Organic.length > 0
          ? top5Organic.reduce(function (s, i) { return s + (i.reviewCount || 0); }, 0) / top5Organic.length
          : 0;
        var top5Prices   = top5Organic.filter(function (i) { return i.price > 0; });
        var avgPrice     = top5Prices.length > 0
          ? Math.round(top5Prices.reduce(function (s, i) { return s + i.price; }, 0) / top5Prices.length)
          : 0;
        var REVIEW_RATE  = CONFIG.MARKET.REVIEW_RATE;
        var estMonthlyMarket = top5Organic.reduce(function (s, item) {
          var est = REVIEW_RATE > 0 ? (item.reviewCount || 0) / REVIEW_RATE : 0;
          return s + ((est / 12) * (item.price || 0));
        }, 0);

        var adScore     = Math.min(adRate * 1.5, 100);
        var reviewScore = Math.min(Math.round((top5Reviews / 100) * 100), 100);
        var marketScore = Math.min(Math.round((estMonthlyMarket / 1000000) * 100), 100);
        var priceScore  = Math.min(Math.round((avgPrice / 2000) * 100), 100);
        var valueScore  = Math.round(adScore * 0.35 + reviewScore * 0.40 + marketScore * 0.15 + priceScore * 0.10);

        var verdict;
        if (valueScore >= 75)      verdict = '🟢 狙い目';
        else if (valueScore >= 55) verdict = '🟡 検討余地あり';
        else if (valueScore >= 35) verdict = '🟠 需要は限定的';
        else                       verdict = '🔴 購買需要が低い';

        return {
          keyword:  kw,
          analyzed: {
            valueScore:       valueScore,
            adRate:           adRate,
            top5AvgReview:    Math.round(top5Reviews),
            estMonthlyMarket: Math.round(estMonthlyMarket),
            totalResults:     total,
            verdict:          verdict,
          },
        };

      } catch (e) {
        AppLogger.warn('KeywordSuggest: 分析エラー', kw + ' / ' + e.message);
        return { keyword: kw, analyzed: null };
      }
    });

    _writeSheet(baseKeyword, results);

    AppLogger.info('KeywordSuggest: 完了', baseKeyword + ' → ' + suggestions.length + '件');
    SpreadsheetApp.getActiveSpreadsheet().toast(
      suggestions.length + '件の補完候補を取得しました',
      '【' + baseKeyword + '】補完キーワード', 5
    );
  }

  return { run: run };

})();
