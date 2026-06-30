/**
 * AppLogger.gs — ログ管理モジュール
 */

var AppLogger = (function () {

  function _write(level, levelName, message, detail) {
    if (level < CONFIG.LOG.CURRENT_LEVEL) return;

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = _getOrCreateSheet(ss);
    var now   = new Date();

    sheet.appendRow([
      Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
      levelName,
      message,
      detail || '',
    ]);

    // 最大行数を超えたら古い行を削除
    var last = sheet.getLastRow();
    if (last > CONFIG.LOG.MAX_ROWS + 1) {
      sheet.deleteRows(2, last - CONFIG.LOG.MAX_ROWS - 1);
    }
  }

  function _getOrCreateSheet(ss) {
    var sheet = ss.getSheetByName(CONFIG.SHEET.LOG);
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.SHEET.LOG);
      sheet.appendRow(['Timestamp', 'Level', 'Message', 'Detail']);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    }
    return sheet;
  }

  return {
    debug: function (msg, detail) { _write(CONFIG.LOG.LEVEL.DEBUG, 'DEBUG', msg, detail); },
    info:  function (msg, detail) { _write(CONFIG.LOG.LEVEL.INFO,  'INFO',  msg, detail); },
    warn:  function (msg, detail) { _write(CONFIG.LOG.LEVEL.WARN,  'WARN',  msg, detail); },
    error: function (msg, detail) { _write(CONFIG.LOG.LEVEL.ERROR, 'ERROR', msg, detail); },
  };

})();
