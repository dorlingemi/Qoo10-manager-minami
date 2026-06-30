/**
 * Trigger.gs — 定期実行Trigger管理モジュール
 *
 * GASエディタから setupTriggers() を一度実行するだけで自動化が完成する。
 */

/**
 * 全Triggerを登録する（重複登録を防ぐため既存を削除してから登録）
 */
function setupTriggers() {
  _deleteTriggers();

  // 毎日 CONFIG.TRIGGER.DAILY_HOUR 時に実行
  ScriptApp.newTrigger('runAll')
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.TRIGGER.DAILY_HOUR)
    .create();

  AppLogger.info('Trigger登録完了: 毎日 ' + CONFIG.TRIGGER.DAILY_HOUR + '時');
  SpreadsheetApp.getUi().alert('Trigger登録完了: 毎日 ' + CONFIG.TRIGGER.DAILY_HOUR + '時に自動実行されます。');
}

/**
 * 全Triggerを削除する
 */
function deleteTriggers() {
  _deleteTriggers();
  AppLogger.info('全Trigger削除完了');
  SpreadsheetApp.getUi().alert('全Triggerを削除しました。');
}

function _deleteTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    ScriptApp.deleteTrigger(t);
  });
}
