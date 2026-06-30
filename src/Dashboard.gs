/**
 * Dashboard.gs — ダッシュボード自動生成モジュール
 */

var Dashboard = (function () {

  /**
   * Dashboardシートを再構築する
   * Productsシートのデータを元に集計・可視化
   */
  function refresh() {
    var ss         = SpreadsheetApp.getActiveSpreadsheet();
    var prodSheet  = ss.getSheetByName(CONFIG.SHEET.PRODUCTS);
    if (!prodSheet || prodSheet.getLastRow() < 2) {
      AppLogger.warn('Dashboard: Productsシートにデータがありません');
      return;
    }

    var dashSheet  = SheetWriter.getOrCreate(CONFIG.SHEET.DASHBOARD, []);
    dashSheet.clearContents();
    dashSheet.clearFormats();

    var data       = prodSheet.getDataRange().getValues();
    var headers    = data[0];
    var rows       = data.slice(1);

    // 列インデックスマップ
    var col = {};
    headers.forEach(function (h, i) { col[h] = i; });

    // ── 1. サマリーカード ──────────────────────────────
    _writeSection(dashSheet, 1, 1, '📊 マーケット概況', '#1F4E79', '#FFFFFF');

    var totalProducts = rows.length;
    var avgScore      = _avg(rows, col['総合スコア']);
    var totalRevenue  = _sum(rows, col['直近3ヶ月売上推計(円)']);
    var avgPrice      = _avg(rows, col['販売価格']);

    _writeKV(dashSheet, 3, 1, [
      ['分析商品数',            totalProducts + '件'],
      ['平均競争スコア',        avgScore.toFixed(1) + 'pt'],
      ['市場合計売上推計(3M)', _yen(totalRevenue)],
      ['平均販売価格',          _yen(avgPrice)],
    ]);

    // ── 2. 売上ランキング Top10 ────────────────────────
    var topByRevenue = _sortDesc(rows, col['直近3ヶ月売上推計(円)']).slice(0, 10);
    _writeSection(dashSheet, 10, 1, '🏆 売上推計ランキング Top10', '#1F4E79', '#FFFFFF');
    _writeTable(dashSheet, 11, 1,
      ['順位', '商品名', '店舗', '月平均販売推計', '3M売上推計', '総合スコア'],
      topByRevenue.map(function (r, i) {
        return [
          i + 1,
          _trunc(r[col['商品名']], 30),
          r[col['店舗']],
          r[col['月平均販売推計']],
          _yen(r[col['直近3ヶ月売上推計(円)']]),
          r[col['総合スコア']],
        ];
      })
    );

    // ── 3. レビューランキング ──────────────────────────
    var topByReview = _sortDesc(rows, col['レビュー数']).slice(0, 10);
    _writeSection(dashSheet, 24, 1, '⭐ レビューランキング Top10', '#1F4E79', '#FFFFFF');
    _writeTable(dashSheet, 25, 1,
      ['順位', '商品名', 'レビュー数', 'レビュー評価', '累計販売数'],
      topByReview.map(function (r, i) {
        return [
          i + 1,
          _trunc(r[col['商品名']], 30),
          r[col['レビュー数']],
          r[col['レビュー評価']],
          r[col['累計販売数']],
        ];
      })
    );

    // ── 4. 価格分布サマリー ────────────────────────────
    _writeSection(dashSheet, 38, 1, '💴 価格分布', '#1F4E79', '#FFFFFF');
    var priceDistrib = _priceBuckets(rows, col['販売価格']);
    _writeTable(dashSheet, 39, 1,
      ['価格帯', '商品数', '割合(%)'],
      priceDistrib
    );

    // ── 5. 競争力スコア分布 ───────────────────────────
    _writeSection(dashSheet, 52, 1, '📈 競争力スコア分布', '#1F4E79', '#FFFFFF');
    var scoreDist = _scoreBuckets(rows, col['総合スコア']);
    _writeTable(dashSheet, 53, 1,
      ['スコア帯', '商品数'],
      scoreDist
    );

    // ── 6. 更新日時 ───────────────────────────────────
    dashSheet.getRange(65, 1).setValue('最終更新: ' + new Date().toLocaleString());

    // 列幅を自動調整
    dashSheet.autoResizeColumns(1, 6);

    AppLogger.info('Dashboard更新完了');
  }

  // ── ヘルパー ──────────────────────────────────────────

  function _writeSection(sheet, row, col, title, bg, fg) {
    var cell = sheet.getRange(row, col, 1, 6);
    cell.merge();
    cell.setValue(title);
    cell.setBackground(bg || '#4A90D9');
    cell.setFontColor(fg || '#FFFFFF');
    cell.setFontWeight('bold');
    cell.setFontSize(12);
  }

  function _writeKV(sheet, startRow, startCol, pairs) {
    pairs.forEach(function (pair, i) {
      sheet.getRange(startRow + i, startCol).setValue(pair[0]).setFontWeight('bold');
      sheet.getRange(startRow + i, startCol + 1).setValue(pair[1]);
    });
  }

  function _writeTable(sheet, startRow, startCol, headers, rowData) {
    var headerRange = sheet.getRange(startRow, startCol, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight('bold').setBackground('#D6E4F0');

    if (rowData.length > 0) {
      sheet.getRange(startRow + 1, startCol, rowData.length, headers.length)
           .setValues(rowData);
    }

    // 交互背景色
    for (var i = 0; i < rowData.length; i++) {
      if (i % 2 === 0) {
        sheet.getRange(startRow + 1 + i, startCol, 1, headers.length)
             .setBackground('#F8FBFF');
      }
    }
  }

  function _sum(rows, colIdx) {
    return rows.reduce(function (acc, r) {
      return acc + (parseFloat(r[colIdx]) || 0);
    }, 0);
  }

  function _avg(rows, colIdx) {
    if (!rows.length) return 0;
    return _sum(rows, colIdx) / rows.length;
  }

  function _sortDesc(rows, colIdx) {
    return rows.slice().sort(function (a, b) {
      return (parseFloat(b[colIdx]) || 0) - (parseFloat(a[colIdx]) || 0);
    });
  }

  function _priceBuckets(rows, colIdx) {
    var buckets = { '~500': 0, '501~1000': 0, '1001~3000': 0, '3001~5000': 0, '5001~': 0 };
    rows.forEach(function (r) {
      var p = parseFloat(r[colIdx]) || 0;
      if      (p <= 500)  buckets['~500']++;
      else if (p <= 1000) buckets['501~1000']++;
      else if (p <= 3000) buckets['1001~3000']++;
      else if (p <= 5000) buckets['3001~5000']++;
      else                buckets['5001~']++;
    });
    var total = rows.length || 1;
    return Object.keys(buckets).map(function (k) {
      return [k, buckets[k], ((buckets[k] / total) * 100).toFixed(1) + '%'];
    });
  }

  function _scoreBuckets(rows, colIdx) {
    var buckets = { '0~20': 0, '21~40': 0, '41~60': 0, '61~80': 0, '81~100': 0 };
    rows.forEach(function (r) {
      var s = parseFloat(r[colIdx]) || 0;
      if      (s <= 20) buckets['0~20']++;
      else if (s <= 40) buckets['21~40']++;
      else if (s <= 60) buckets['41~60']++;
      else if (s <= 80) buckets['61~80']++;
      else              buckets['81~100']++;
    });
    return Object.keys(buckets).map(function (k) { return [k, buckets[k]]; });
  }

  function _yen(n) {
    return '¥' + Math.round(n || 0).toLocaleString();
  }

  function _trunc(str, len) {
    if (!str) return '';
    return String(str).length > len ? String(str).slice(0, len) + '…' : str;
  }

  // ── 公開API ───────────────────────────────────────────

  return { refresh: refresh };

})();
