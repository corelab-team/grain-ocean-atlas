const path = require('node:path');
const { validateAssets } = require('./files.cjs');
validateAssets(path.resolve(__dirname, '../dist/export-only')).then(bytes => {
  console.log(`Offline bundle complete: ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
}).catch(error => { console.error(error.message); process.exitCode = 1; });
