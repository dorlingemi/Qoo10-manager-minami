/**
 * KeywordValue.gs — キーワード購買価値評価モジュール
 *
 * 指定キーワードの検索結果を分析し、
 * 「どれだけ購買意図のある検索が来ているか」を推定する。
 * 検索結果ページのみ使用（商品詳細取得なし）→ 約90秒で完了。
 */

var KeywordValue = (function () {

  var SHEET_NAME   = 'KeywordValue';
  var REVIEW_RATE  = CONFIG.MARKET.REVIEW_RATE;  // 30%

  // ── 分析ロジック ─────────────────────────────────────────

  function _analyze(keyword, items) {
    var total = items.length;
    if (total === 0) return null;

    var sponsored   = items.filter(function (i) { return i.isSponsored; });
    var organic     = items.filter(function (i) { return !i.isSponsored; });
    var top5Organic = organic.slice(0, 5);

    // 広告競争率
    var adRate = Math.round((sponsored.length / total) * 100);

    // 上位5件オーガニック商品の平均レビュー数
    var top5Reviews = top5Organic.length > 0
      ? top5Organic.reduce(function (s, i) { return s + (i.reviewCount || 0); }, 0) / top5Organic.length
      : 0;

    // 全商品レビュー数合計（市場全体の購買実績）
    var totalReviews = items.reduce(function (s, i) { return s + (i.reviewCount || 0); }, 0);

    // 上位5件の平均価格
    var top5Prices = top5Organic.filter(function (i) { return i.price > 0; });
    var avgPrice = top5Prices.length > 0
      ? Math.round(top5Prices.reduce(function (s, i) { return s + i.price; }, 0) / top5Prices.length)
      : 0;

    // 推定月間市場規模（上位5件の月間推計売上合計）
    // 式: レビュー数 ÷ レビュー率(30%) × 価格 ÷ 上市月数(仮12ヶ月) × 1ヶ月
    var estMonthlyMarket = top5Organic.reduce(function (s, item) {
      var estTotalSales = REVIEW_RATE > 0 ? (item.reviewCount || 0) / REVIEW_RATE : 0;
      var estMonthlySales = estTotalSales / 12;
      return s + (estMonthlySales * (item.price || 0));
    }, 0);

    // ── スコア計算（各0〜100） ────────────────────────────

    // 広告競争スコア：広告が多い = 商業価値が高い
    var adScore = Math.min(adRate * 1.5, 100);

    // レビュー密度スコア：上位5件の平均レビュー数（多いほど需要あり）
    // 100件以上で満点
    var reviewScore = Math.min(Math.round((top5Reviews / 100) * 100), 100);

    // 市場規模スコア：月間100万円以上で満点
    var marketScore = Math.min(Math.round((estMonthlyMarket / 1000000) * 100), 100);

    // 価格スコア：平均価格2000円以上で満点
    var priceScore = Math.min(Math.round((avgPrice / 2000) * 100), 100);

    // 総合購買価値スコア（重み付き）
    var valueScore = Math.round(
      adScore     * 0.35 +
      reviewScore * 0.40 +
      marketScore * 0.15 +
      priceScore  * 0.10
    );

    // 判定
    var verdict, stars;
    if (valueScore >= 75) { verdict = '🟢 狙い目'; stars = '★★★★★'; }
    else if (valueScore >= 55) { verdict = '🟡 検討余地あり'; stars = '★★★★☆'; }
    else if (valueScore >= 35) { verdict = '🟠 需要は限定的'; stars = '★★★☆☆'; }
    else { verdict = '🔴 購買需要が低い'; stars = '★★☆☆☆'; }

    return {
      keyword:           keyword,
      checkedAt:         new Date(),
      totalResults:      total,
      sponsoredCount:    sponsored.length,
      organicCount:      organic.length,
      adRate:            adRate,
      top5AvgReview:     Math.round(top5Reviews),
      totalReviews:      totalReviews,
      avgPrice:          avgPrice,
      estMonthlyMarket:  Math.round(estMonthlyMarket),
      adScore:           Math.round(adScore),
      reviewScore:       reviewScore,
      marketScore:       marketScore,
      priceScore:        priceScore,
      valueScore:        valueScore,
      verdict:           verdict,
      stars:             stars,
    };
  }

  // ── シート出力 ───────────────────────────────────────────

  function _writeSheet(r) {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
    }

    // 毎回クリアして1キーワードのレポートを見やすく表示
    sheet.clearContents();
    sheet.clearFormats();
    sheet.setColumnWidth(1, 220);
    sheet.setColumnWidth(2, 280);
    sheet.setColumnWidth(3, 160);

    var rows = [
      // タイトル
      ['__TITLE__', 'キーワード購買価値レポート', ''],
      ['確認日時', Utilities.formatDate(r.checkedAt, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'), ''],
      ['対象キーワード', r.keyword, ''],
      ['__BLANK__', '', ''],

      // 需要指標
      ['__HEAD__', '需要の大きさ', ''],
      ['検索結果件数', r.totalResults + '件',                   '競合が多い = 需要あり'],
      ['広告出稿商品数', r.sponsoredCount + '件 / ' + r.totalResults + '件中',
                                                               '広告主が参入 = 商業価値の証拠'],
      ['広告競争率', r.adRate + '%',                            '高いほど売れるキーワード'],
      ['上位5件 平均レビュー数', r.top5AvgReview.toLocaleString() + '件',
                                                               '実購買の証拠（多いほど需要大）'],
      ['全商品 レビュー合計', r.totalReviews.toLocaleString() + '件',
                                                               '市場全体の購買実績'],
      ['__BLANK__', '', ''],

      // 市場規模
      ['__HEAD__', '市場規模', ''],
      ['上位5件 平均価格', '¥' + r.avgPrice.toLocaleString(),    '単価が高いほど購買価値大'],
      ['推定月間市場規模', '¥' + r.estMonthlyMarket.toLocaleString(),
                                                               'レビュー数÷30%×価格÷12ヶ月'],
      ['__BLANK__', '', ''],

      // スコア詳細
      ['__HEAD__', 'スコア内訳', '重み'],
      ['広告競争スコア', r.adScore + ' / 100',   '35%'],
      ['レビュー密度スコア', r.reviewScore + ' / 100', '40%'],
      ['市場規模スコア', r.marketScore + ' / 100', '15%'],
      ['価格帯スコア', r.priceScore + ' / 100',  '10%'],
      ['__BLANK__', '', ''],

      // 判定
      ['__RESULT__', '購買価値スコア', r.valueScore + ' / 100'],
      ['__RESULT__', '市場活性度',     r.stars],
      ['__RESULT__', '判定',           r.verdict],
    ];

    rows.forEach(function (row, i) {
      var rowNum = i + 1;
      var type   = row[0];

      if (type === '__TITLE__') {
        sheet.getRange(rowNum, 1, 1, 3).merge()
          .setValue(row[1])
          .setFontSize(14).setFontWeight('bold')
          .setBackground('#1F3864').setFontColor('#FFFFFF')
          .setHorizontalAlignment('center');
        sheet.setRowHeight(rowNum, 40);

      } else if (type === '__HEAD__') {
        sheet.getRange(rowNum, 2, 1, 2).merge()
          .setValue(row[1])
          .setFontWeight('bold')
          .setBackground('#2E4057').setFontColor('#FFFFFF');
        sheet.getRange(rowNum, 1).setBackground('#2E4057');
        sheet.setRowHeight(rowNum, 28);

      } else if (type === '__RESULT__') {
        sheet.getRange(rowNum, 1).setValue(row[1])
          .setFontWeight('bold').setBackground('#FFF9C4').setFontColor('#5D4037');
        sheet.getRange(rowNum, 2, 1, 2).merge()
          .setValue(row[2])
          .setFontSize(13).setFontWeight('bold')
          .setBackground('#FFF9C4').setFontColor('#E65100')
          .setHorizontalAlignment('center');
        sheet.setRowHeight(rowNum, 36);

      } else if (type === '__BLANK__') {
        sheet.setRowHeight(rowNum, 10);

      } else {
        sheet.getRange(rowNum, 1).setValue(row[0])
          .setFontWeight('bold').setFontColor('#333333')
          .setBackground(i % 2 === 0 ? '#F5F8FF' : '#FFFFFF');
        sheet.getRange(rowNum, 2).setValue(row[1])
          .setBackground(i % 2 === 0 ? '#F5F8FF' : '#FFFFFF');
        sheet.getRange(rowNum, 3).setValue(row[2])
          .setFontColor('#888888').setFontSize(9)
          .setBackground(i % 2 === 0 ? '#F5F8FF' : '#FFFFFF');
        sheet.setRowHeight(rowNum, 28);
      }
    });

    sheet.getRange(1, 1, rows.length, 3)
      .setBorder(true, true, true, true, true, true,
        '#CCCCCC', SpreadsheetApp.BorderStyle.SOLID)
      .setWrap(true).setVerticalAlignment('middle');

    // 履歴シートにも追記
    _appendHistory(r);

    ss.setActiveSheet(sheet);
  }

  // ── 履歴シート（KeywordValueHistory）に追記 ─────────────

  function _appendHistory(r) {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('KeywordValueHistory');
    if (!sheet) {
      sheet = ss.insertSheet('KeywordValueHistory');
      sheet.getRange(1, 1, 1, 11).setValues([[
        '確認日時', 'キーワード', '検索件数', '広告率(%)',
        '上位平均レビュー', 'レビュー合計', '平均価格',
        '推定月間市場規模', '購買価値スコア', '判定', '星評価',
      ]]).setFontWeight('bold').setBackground('#1F3864').setFontColor('#FFFFFF');
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([
      r.checkedAt, r.keyword, r.totalResults, r.adRate,
      r.top5AvgReview, r.totalReviews, r.avgPrice,
      r.estMonthlyMarket, r.valueScore, r.verdict, r.stars,
    ]);
  }

  // ── 公開エントリポイント ─────────────────────────────────

  function check(keyword) {
    AppLogger.info('KeywordValue: 開始', keyword);

    var html = Crawler.fetchSearch(keyword, 1);
    if (!html) {
      AppLogger.error('KeywordValue: HTML取得失敗', keyword);
      return;
    }

    var items = Parser.parseSearchResults(html);
    AppLogger.info('KeywordValue: 検索結果', items.length + '件取得');

    var result = _analyze(keyword, items);
    if (!result) {
      AppLogger.warn('KeywordValue: 分析失敗（結果0件）', keyword);
      return;
    }

    _writeSheet(result);

    AppLogger.info('KeywordValue: 完了',
      keyword + ' → スコア:' + result.valueScore + ' / ' + result.verdict);

    SpreadsheetApp.getActiveSpreadsheet().toast(
      result.verdict + '（スコア: ' + result.valueScore + '/100）',
      '【' + keyword + '】購買価値', 8
    );
  }

  return { check: check };

})();
