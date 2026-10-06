const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');

(async () => {
  const packagedExe = process.argv[2];
  const application = await _electron.launch({
    executablePath: packagedExe || require('electron'),
    args: packagedExe ? ['--verify'] : [path.resolve(__dirname, '..'), '--verify'], timeout: 60000
  });
  try {
    const page = await application.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForLoadState('load');
    await page.waitForFunction(() => window.StoryApp && StoryApp.state().screen === 'intro');
    // Chromium's network is offline before the reload; custom-protocol files remain available.
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.session.enableNetworkEmulation({ offline: true });
    });
    await page.reload();
    await page.waitForFunction(() => { const art = document.querySelector('#sec-story .sc-intro-art'); return art ? art.querySelectorAll('img').length >= 16 && Array.from(art.querySelectorAll('img')).every(img => img.naturalWidth > 0) : document.querySelector('#sec-story video')?.currentTime > 0.1; });
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    const networkBlocked = await application.evaluate(async ({ BrowserWindow }) => {
      try { await BrowserWindow.getAllWindows()[0].webContents.session.fetch('https://example.com/'); return false; }
      catch { return true; }
    });
    assert(networkBlocked, 'Internet requests must fail');
    const range = await page.evaluate(async () => {
      const response = await fetch('assets/video/grain-scan.mp4', { headers: { Range: 'bytes=0-15' } });
      return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
    });
    assert.deepEqual(range, { status: 206, bytes: 16 });
    await page.evaluate(() => StoryApp.go('quality-2'));
    await page.waitForFunction(() => StoryApp.state().screen === 'quality-2');
    await page.waitForFunction(() => document.querySelector('#sec-story video')?.currentTime > 0.1);
    assert((await page.locator('#sec-story .is-report').innerText()).includes('257,0'));
    await page.evaluate(() => StoryApp.go('seed-3'));
    await page.waitForFunction(() => StoryApp.state().screen === 'seed-3');
    await page.getByRole('button', { name: 'Запустить обзор с БПЛА', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('#sec-story .sc-weed.is-found').length === 3);
    await page.locator('#sec-story .sc-grid.is-ico .sc-pick').first().click();
    assert.equal(await page.getByRole('dialog').count(), 1);
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.evaluate(() => Shell.go('monitoring'));
    await page.waitForFunction(() => Shell.section() === 'monitoring' && MonScreen.stats().regions > 0);
    await page.locator('#sec-monitoring #search').fill('Рост');
    await page.locator('#sec-monitoring #search-results button').click();
    await page.waitForFunction(() => MonScreen.stats().screen === 'region');
    await page.waitForFunction(() => { const v = document.querySelector('#sec-monitoring #scene-video'); return v && v.videoWidth === 1920 && v.currentTime > 0.1 && !v.paused && v.muted && v.loop; });
    await page.waitForTimeout(450);
    await page.evaluate(() => Shell.go('globe'));
    await page.waitForFunction(() => Shell.section() === 'globe' && Globe.ready());
    assert(await page.locator('#sec-monitoring #scene-video').evaluate(v => v.paused));
    await page.locator('#sec-globe').getByRole('button', { name: '2015', exact: true }).click();
    assert((await page.locator('#sec-globe #news-list').innerText()).includes('Требования стран-импортёров'));
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#sec-globe img')).filter(img => img.offsetParent).every(img => img.naturalWidth > 0));
    const preferences = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const prefs = window.webContents.getLastWebPreferences();
      return { contextIsolation: prefs.contextIsolation, sandbox: prefs.sandbox, nodeIntegration: prefs.nodeIntegration };
    });
    assert.deepEqual(preferences, { contextIsolation: true, sandbox: true, nodeIntegration: false });
    assert.deepEqual(errors, []);
    if (process.env.SCREENSHOT_DIR) {
      await fs.mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'electron-offline-globe.png') });
    }
    console.log('PASS Electron offline: intro artwork/scan video, byte-range seeking, weeds, region search, globe, denied internet and isolated renderer');
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
