/**
 * SheetWriter.gs — Google Sheets 書き込みモジュール
 */

var SheetWriter = (function () {

  // ── シート取得 / 初期化 ────────────────────────────────

  function _getOrCreate(name, headers) {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      if (headers && headers.length) {
        sheet.appendRow(headers);
        sheet.setFrozenRows(1);
        sheet.getRange(1, 1, 1, headers.length)
             .setFontWeight('bold')
             .setBackground('#4A90D9')
             .setFontColor('#FFFFFF');
      }
    }
    return sheet;
  }

  // ── Inputシート（ユーザー入力読み取り） ──────────────────

  function readInputs() {
    var sheet = _getOrCreate(CONFIG.SHEET.INPUT, ['タイプ (url/keyword)', '入力値', '最終実行', 'ステータス']);
    var data  = sheet.getDataRange().getValues();
    var inputs = [];
    for (var i = 1; i < data.length; i++) {
      var type  = String(data[i][0]).toLowerCase().trim();
      var value = String(data[i][1]).trim();
      if (!value) continue;
      inputs.push({ type: type, value: value, row: i + 1 });
    }
    return inputs;
  }

  function markInputStatus(row, status) {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET.INPUT);
    if (!sheet) return;
    sheet.getRange(row, 3).setValue(new Date());
    sheet.getRange(row, 4).setValue(status);
  }

  // ── Productsシート ────────────────────────────────────

  var PRODUCT_HEADERS = [
    'URL', '商品名', '商品ID', '店舗', 'ブランド', 'カテゴリ',
    '販売価格', '定価', '割引率(%)', 'Shopクーポン', '商品クーポン', '最終価格',
    '送料', '送料無料', '配送方法', '配送日数',
    '累計販売数', 'レビュー数', 'レビュー評価', 'ウィッシュリスト数',
    '画像枚数', '動画あり', 'SKU数', 'タイトル文字数', '詳細文字量',
    '店舗評価', '店舗グレード',
    '月平均販売推計', '直近3ヶ月売上推計(円)', '総合スコア',
    '更新日時', '入力キー',
  ];

  function upsertProduct(product, analyzed, inputKey) {
    var sheet = _getOrCreate(CONFIG.SHEET.PRODUCTS, PRODUCT_HEADERS);
    var url   = product.url;
    var row   = _findRow(sheet, url, 1);

    var s    = analyzed.sales   || {};
    var vals = [
      url,
      product.title,
      product.itemNo,
      product.shopName,
      product.brand,
      product.category,
      product.salePrice,
      product.originalPrice,
      product.discount,
      product.shopCoupon,
      product.itemCoupon,
      product.finalPrice,
      product.shippingFee,
      product.isFreeShip ? '●' : '',
      product.shippingMethod,
      product.shippingDays,
      product.totalSales,
      product.reviewCount,
      product.reviewScore,
      product.wishlistCount,
      product.imageCount,
      product.hasVideo ? '●' : '',
      product.skuCount,
      product.titleLength,
      product.descLength,
      product.storeScore,
      product.storeGrade,
      s.avgMonthlySales,
      s.recentMoRevenue,
      analyzed.competitive_score,
      new Date(),
      inputKey || '',
    ];

    if (row) {
      sheet.getRange(row, 1, 1, vals.length).setValues([vals]);
    } else {
      sheet.appendRow(vals);
    }
  }

  // ── Competitorsシート ─────────────────────────────────

  var COMPETITOR_HEADERS = [
    '検索キー', '順位', 'スポンサー', 'URL', '商品名', '店舗', 'ブランド',
    '販売価格', 'レビュー数', 'レビュー評価', '累計販売数',
    '月平均販売推計', '直近3ヶ月売上推計(円)', '総合スコア', '更新日時',
  ];

  function writeCompetitor(searchKey, rank, isSponsored, product, analyzed) {
    var sheet = _getOrCreate(CONFIG.SHEET.COMPETITORS, COMPETITOR_HEADERS);
    var s     = analyzed.sales || {};
    sheet.appendRow([
      searchKey,
      rank,
      isSponsored ? '●' : '',
      product.url,
      product.title,
      product.shopName,
      product.brand,
      product.salePrice,
      product.reviewCount,
      product.reviewScore,
      product.totalSales,
      s.avgMonthlySales,
      s.recentMoRevenue,
      analyzed.competitive_score,
      new Date(),
    ]);
  }

  // ── Analysisシート（競品対比表） ──────────────────────

  function writeComparisonTable(keyword, tableData) {
    var sheet = _getOrCreate(CONFIG.SHEET.ANALYSIS, []);
    // 既存データの後ろに追記
    var lastRow = sheet.getLastRow();
    if (lastRow > 0) {
      sheet.appendRow(['']);
    }
    sheet.appendRow(['■ キーワード: ' + keyword + '  (' + new Date().toLocaleString() + ')']);

    tableData.forEach(function (row, i) {
      sheet.appendRow(row);
      // ヘッダー行をボールド
      if (i === 0) {
        var r = sheet.getLastRow();
        sheet.getRange(r, 1, 1, row.length)
             .setFontWeight('bold')
             .setBackground('#F0F4FF');
      }
    });
  }

  // ── ユーティリティ ────────────────────────────────────

  /**
   * 指定列でkeyと一致する行番号を返す（なければnull）
   */
  function _findRow(sheet, key, colIndex) {
    var vals = sheet.getRange(2, colIndex, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (vals[i][0] === key) return i + 2;
    }
    return null;
  }

  // ── 公開API ───────────────────────────────────────────

  return {
    readInputs:           readInputs,
    markInputStatus:      markInputStatus,
    upsertProduct:        upsertProduct,
    writeCompetitor:      writeCompetitor,
    writeComparisonTable: writeComparisonTable,
    getOrCreate:          _getOrCreate,
  };

})();
