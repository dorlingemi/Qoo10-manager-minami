/**
 * LarkApi.gs — Lark Bitable連携（分析結果の永続保存）
 *
 * runAll完了後にGoogle SheetsのデータをLark多維表格（Bitable）へ同期する。
 * 認証: テナントアクセストークン（App ID + App Secret → 2時間有効）
 *
 * Bitable構成:
 *   tblProducts    — 商品マスタ（Products相当）
 *   tblCompetitors — 競合商品（Competitors相当）
 *   tblAnalysis    — 比較分析（Analysis相当）
 */

var LarkApi = (function () {

  var BASE_URL = 'https://open.larksuite.com/open-apis';

  // ── テナントアクセストークン取得 ─────────────────────────

  function _getToken() {
    var cfg = CONFIG.LARK;
    var res = UrlFetchApp.fetch(BASE_URL + '/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({ app_id: cfg.APP_ID, app_secret: cfg.APP_SECRET }),
      muteHttpExceptions: true,
    });
    var body = JSON.parse(res.getContentText('UTF-8'));
    if (body.code !== 0) throw new Error('Lark認証失敗: ' + body.msg);
    return body.tenant_access_token;
  }

  // ── Bitable汎用リクエスト ────────────────────────────────

  function _request(method, path, token, payload) {
    var options = {
      method: method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      muteHttpExceptions: true,
    };
    if (payload) options.payload = JSON.stringify(payload);
    var res = UrlFetchApp.fetch(BASE_URL + path, options);
    var body = JSON.parse(res.getContentText('UTF-8'));
    if (body.code !== 0) throw new Error('Lark APIエラー [' + path + ']: ' + body.msg);
    return body.data;
  }

  // ── テーブルID一覧を取得（テーブル名→IDマップ） ────────

  function _getTableMap(token) {
    var appToken = CONFIG.LARK.BITABLE_APP_TOKEN;
    var data = _request('GET', '/bitable/v1/apps/' + appToken + '/tables?page_size=50', token);
    var map = {};
    (data.items || []).forEach(function (t) { map[t.name] = t.table_id; });
    return map;
  }

  // ── テーブルがなければ作成 ────────────────────────────────

  function _ensureTable(token, tableMap, tableName, fields) {
    if (tableMap[tableName]) return tableMap[tableName];
    var appToken = CONFIG.LARK.BITABLE_APP_TOKEN;
    var data = _request('POST', '/bitable/v1/apps/' + appToken + '/tables', token, {
      table: { name: tableName, fields: fields },
    });
    AppLogger.info('Lark: テーブル作成完了', tableName);
    return data.table_id;
  }

  // ── レコード一括追加 ─────────────────────────────────────

  function _batchCreate(token, tableId, records) {
    if (!records.length) return;
    var appToken = CONFIG.LARK.BITABLE_APP_TOKEN;
    var chunkSize = 500;  // Lark API上限
    for (var i = 0; i < records.length; i += chunkSize) {
      var chunk = records.slice(i, i + chunkSize);
      _request('POST', '/bitable/v1/apps/' + appToken + '/tables/' + tableId + '/records/batch_create', token, {
        records: chunk.map(function (r) { return { fields: r }; }),
      });
    }
    AppLogger.info('Lark: レコード追加完了', tableId + ' (' + records.length + '件)');
  }

  // ── テーブル定義 ─────────────────────────────────────────

  var PRODUCTS_FIELDS = [
    { field_name: 'キーワード',    type: 1 },
    { field_name: 'タイトル',      type: 1 },
    { field_name: '販売価格',      type: 2 },
    { field_name: '定価',          type: 2 },
    { field_name: 'レビュー数',    type: 2 },
    { field_name: 'レビュースコア', type: 2 },
    { field_name: 'カテゴリ',      type: 1 },
    { field_name: 'ショップ名',    type: 1 },
    { field_name: '店舗評価',      type: 2 },
    { field_name: '送料無料',      type: 1 },
    { field_name: '発送国',        type: 1 },
    { field_name: '推定月間売上数', type: 2 },
    { field_name: '推定月間売上額', type: 2 },
    { field_name: '総合スコア',    type: 2 },
    { field_name: '記録日時',      type: 1 },
    { field_name: 'URL',           type: 15 },  // type:15 = URLフィールド
  ];

  var COMPETITORS_FIELDS = [
    { field_name: 'キーワード',    type: 1 },
    { field_name: '順位',          type: 2 },
    { field_name: '広告',          type: 1 },
    { field_name: 'タイトル',      type: 1 },
    { field_name: '販売価格',      type: 2 },
    { field_name: 'レビュー数',    type: 2 },
    { field_name: 'レビュースコア', type: 2 },
    { field_name: 'ショップ名',    type: 1 },
    { field_name: '総合スコア',    type: 2 },
    { field_name: '記録日時',      type: 1 },
    { field_name: 'URL',           type: 15 },
  ];

  var ANALYSIS_FIELDS = [
    { field_name: 'キーワード',    type: 1 },
    { field_name: '項目',          type: 1 },
    { field_name: '自社',          type: 1 },
    { field_name: '競合1位',       type: 1 },
    { field_name: '競合2位',       type: 1 },
    { field_name: '市場規模推定',  type: 1 },
    { field_name: '記録日時',      type: 1 },
  ];

  // ── Google Sheets → Lark変換 ─────────────────────────────

  function _sheetToRecords(sheetName, fieldMapping) {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return [];
    var rows  = sheet.getDataRange().getValues();
    if (rows.length < 2) return [];
    var headers = rows[0];
    var now     = new Date().toLocaleString('ja-JP');
    var records = [];

    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      if (!row[0]) continue;  // 空行スキップ
      var record = { '記録日時': now };
      fieldMapping.forEach(function (m) {
        var colIdx = headers.indexOf(m.sheetCol);
        if (colIdx >= 0 && row[colIdx] !== '' && row[colIdx] !== null && row[colIdx] !== undefined) {
          var val = row[colIdx];
          if (m.larkField === 'URL') {
            record[m.larkField] = { link: String(val), text: String(val) };
          } else if (typeof val === 'number') {
            record[m.larkField] = val;
          } else {
            record[m.larkField] = String(val);
          }
        }
      });
      records.push(record);
    }
    return records;
  }

  // ── シート列名 → Larkフィールド名マッピング ──────────────

  // シート列名はSheetWriter.gsのPRODUCT_HEADERS/COMPETITOR_HEADERSに合わせる
  var PRODUCTS_MAP = [
    { sheetCol: '入力キー',              larkField: 'キーワード' },
    { sheetCol: '商品名',                larkField: 'タイトル' },
    { sheetCol: '販売価格',              larkField: '販売価格' },
    { sheetCol: '定価',                  larkField: '定価' },
    { sheetCol: 'レビュー数',            larkField: 'レビュー数' },
    { sheetCol: 'レビュー評価',          larkField: 'レビュースコア' },
    { sheetCol: 'カテゴリ',              larkField: 'カテゴリ' },
    { sheetCol: '店舗',                  larkField: 'ショップ名' },
    { sheetCol: '店舗評価',              larkField: '店舗評価' },
    { sheetCol: '送料無料',              larkField: '送料無料' },
    { sheetCol: '月平均販売推計',        larkField: '推定月間売上数' },
    { sheetCol: '直近3ヶ月売上推計(円)', larkField: '推定月間売上額' },
    { sheetCol: '総合スコア',            larkField: '総合スコア' },
    { sheetCol: 'URL',                   larkField: 'URL' },
  ];

  var COMPETITORS_MAP = [
    { sheetCol: '検索キー',              larkField: 'キーワード' },
    { sheetCol: '順位',                  larkField: '順位' },
    { sheetCol: 'スポンサー',            larkField: '広告' },
    { sheetCol: '商品名',                larkField: 'タイトル' },
    { sheetCol: '販売価格',              larkField: '販売価格' },
    { sheetCol: 'レビュー数',            larkField: 'レビュー数' },
    { sheetCol: 'レビュー評価',          larkField: 'レビュースコア' },
    { sheetCol: '店舗',                  larkField: 'ショップ名' },
    { sheetCol: '総合スコア',            larkField: '総合スコア' },
    { sheetCol: 'URL',                   larkField: 'URL' },
  ];

  // ── メイン同期関数 ────────────────────────────────────────

  /**
   * Google SheetsのデータをLark Bitableに同期する
   * runAll()完了後に呼び出す
   */
  function syncToLark() {
    if (!CONFIG.LARK.ENABLED) {
      AppLogger.info('LarkApi: ENABLED=false のためスキップ');
      return;
    }

    AppLogger.info('LarkApi: Bitable同期開始');

    try {
      var token    = _getToken();
      var tableMap = _getTableMap(token);

      // テーブルが存在しなければ自動作成
      var productsId    = _ensureTable(token, tableMap, '商品マスタ',   PRODUCTS_FIELDS);
      var competitorsId = _ensureTable(token, tableMap, '競合商品',     COMPETITORS_FIELDS);

      // データ読み取り・変換・投入
      var prodRecords = _sheetToRecords(CONFIG.SHEET.PRODUCTS,    PRODUCTS_MAP);
      var compRecords = _sheetToRecords(CONFIG.SHEET.COMPETITORS, COMPETITORS_MAP);

      _batchCreate(token, productsId,    prodRecords);
      _batchCreate(token, competitorsId, compRecords);

      AppLogger.info('LarkApi: Bitable同期完了', '商品:' + prodRecords.length + '件 / 競合:' + compRecords.length + '件');
      SpreadsheetApp.getActiveSpreadsheet().toast(
        'Lark同期完了（商品:' + prodRecords.length + '件 / 競合:' + compRecords.length + '件）',
        'Qoo10分析', 5
      );
    } catch (e) {
      AppLogger.error('LarkApi: 同期エラー', e.message);
    }
  }

  return { syncToLark: syncToLark };

})();
