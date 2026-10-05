const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { resolveAsset, isAllowedRequest, parseRange, fileResponse, validateAssets, REQUIRED_ASSETS } = require('./files.cjs');

test('Only bundled application requests are allowed', () => {
  for (const value of ['atlas://app/index.html', 'atlas://app/assets/video/intro-loop.mp4', 'data:image/png;base64,AA', 'blob:atlas://app/id']) assert(isAllowedRequest(value), value);
  for (const value of ['https://example.com', 'http://localhost:8765', 'wss://example.com', 'file:///C:/secret.txt', 'atlas://other/index.html', 'atlas://user@app/index.html', 'atlas://app:80/index.html']) assert(!isAllowedRequest(value), value);
});
test('Encoded traversal, Windows paths and foreign origins cannot escape the bundle', () => {
  const root = path.resolve('bundle');
  assert.equal(resolveAsset(root, 'atlas://app/'), path.join(root, 'index.html'));
  assert.equal(resolveAsset(root, 'atlas://app/assets/a.mp4?x=1'), path.join(root, 'assets/a.mp4'));
  for (const value of ['atlas://app/..%2Fsecret', 'atlas://app/%2e%2e%5csecret', 'atlas://app/index.html:secret', 'atlas://app/%00', 'https://app/index.html']) assert.throws(() => resolveAsset(root, value), value);
});
test('Video byte ranges handle seeking, suffixes and invalid requests', () => {
  assert.deepEqual(parseRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseRange('bytes=7-', 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange('bytes=0-999', 10), { start: 0, end: 9 });
  for (const value of ['bytes=10-', 'bytes=8-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4']) assert.equal(parseRange(value, 10), false);
});
test('Local protocol streams bytes and handles HEAD, missing files and methods', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'grain-assets-test-'));
  try {
    await fs.writeFile(path.join(root, 'sample.mp4'), Buffer.from('0123456789'));
    const req = (file, options) => new Request('atlas://app/' + file, options);
    const response = await fileResponse(req('sample.mp4', { headers: { Range: 'bytes=2-5' } }), root);
    assert.equal(response.status, 206); assert.equal(response.headers.get('Content-Range'), 'bytes 2-5/10');
    assert.equal(response.headers.get('Content-Type'), 'video/mp4'); assert.equal(await response.text(), '2345');
    const head = await fileResponse(req('sample.mp4', { method: 'HEAD' }), root);
    assert.equal(head.headers.get('Content-Length'), '10'); assert.equal(await head.text(), '');
    assert.equal((await fileResponse(req('sample.mp4', { headers: { Range: 'bytes=99-' } }), root)).status, 416);
    assert.equal((await fileResponse(req('missing.mp4'), root)).status, 404);
    assert.equal((await fileResponse(req('sample.mp4', { method: 'POST' }), root)).status, 405);
    assert.equal((await fileResponse(req('..%2Fsecret'), root)).status, 403);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});


test('Offline asset manifest detects missing heavy Figma images', async () => {
  const temporaryRoot = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(temporaryRoot, 'grain-manifest-test-'));
  try {
    for (const file of REQUIRED_ASSETS) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), file === 'index.html' ? '<div id="sec-story"></div><div id="sec-globe"></div><div id="sec-monitoring"></div>' : 'fixture');
    }
    await fs.writeFile(path.join(root, 'assets-manifest.json'), JSON.stringify(['assets/photos/design.webp']));
    await assert.rejects(validateAssets(root), { code: 'ENOENT' });
    await fs.mkdir(path.join(root, 'assets/photos'), { recursive: true });
    await fs.writeFile(path.join(root, 'assets/photos/design.webp'), 'image fixture');
    assert(await validateAssets(root) > 0);
    await fs.writeFile(path.join(root, 'assets-manifest.json'), JSON.stringify(['assets/../secret']));
    await assert.rejects(validateAssets(root), /Invalid resource manifest path/);
  } finally {
    const relative = path.relative(temporaryRoot, path.resolve(root));
    assert(!path.isAbsolute(relative) && !relative.includes(path.sep) && relative.startsWith('grain-manifest-test-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});
