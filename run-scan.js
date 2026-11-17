'use strict';
// 开发用：无头运行完整扫描并写入缓存（node run-scan.js）
const store = require('./src/store');
const scanner = require('./src/scanner');

(async () => {
  const t0 = Date.now();
  try {
    const data = await scanner.runScan({}, p => {
      if (p.phase === 'projects') console.log('scan', p.current + '/' + p.total, p.name);
    });
    store.setScan(data);
    store.appendHistory(data);
    console.log('DONE', data.projects.length, 'projects in', ((Date.now() - t0) / 1000).toFixed(0) + 's');
    process.exit(0);
  } catch (e) {
    console.error('SCAN FAILED', (e && e.stack) || e);
    process.exit(1);
  }
})();
