const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');

const REQUIRED_ASSETS = [
  'index.html',
  'assets/textures/earth_land_8192_figma.jpg',
  'assets/video/intro-loop.mp4',
  'assets/video/grain-scan.mp4',
  'assets/video/globe-2016.mp4',
  'assets/video/globe-2025.mp4'
];
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2'
};
// The shipped page embeds its scripts, styles, fonts and small images.
const CSP = "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; " +
  "worker-src 'self' blob:; object-src 'none'; frame-src 'none'; " +
  "base-uri 'self'; form-action 'none'";

function isAppURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'atlas:' && url.hostname === 'app' &&
      !url.port && !url.username && !url.password;
  } catch { return false; }
}

function isAllowedRequest(value) {
  return isAppURL(value) || value.startsWith('data:') || value.startsWith('blob:atlas://app/');
}

function isInside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function resolveAsset(root, value) {
  if (!isAppURL(value)) throw new Error('Invalid application URL');
  const pathname = decodeURIComponent(new URL(value).pathname);
  if (/[\\:\0]/.test(pathname)) throw new Error('Invalid asset path');
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!isInside(root, file)) throw new Error('Asset path escapes application');
  return file;
}

function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return false;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start >= size || end < start) return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

async function fileResponse(request, root) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  let file;
  try { file = resolveAsset(root, request.url); }
  catch { return new Response(null, { status: 403 }); }
  try {
    const [realRoot, realFile] = await Promise.all([fsp.realpath(root), fsp.realpath(file)]);
    if (!isInside(realRoot, realFile)) return new Response(null, { status: 403 });
    const stat = await fsp.stat(realFile);
    if (!stat.isFile()) return new Response(null, { status: 404 });
    const headers = {
      'Content-Type': CONTENT_TYPES[path.extname(realFile).toLowerCase()] || 'application/octet-stream',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes'
    };
    const range = parseRange(request.headers.get('range'), stat.size);
    if (range === false) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${stat.size}` } });
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : stat.size - 1;
    headers['Content-Length'] = String(range ? end - start + 1 : stat.size);
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    const body = request.method === 'HEAD' || stat.size === 0 ? null :
      Readable.toWeb(fs.createReadStream(realFile, { start, end }));
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return new Response(null, { status: 404 });
    console.error('Cannot read bundled asset:', error.message);
    return new Response(null, { status: 500 });
  }
}

async function validateAssets(root) {
  let files = REQUIRED_ASSETS;
  try {
    const manifest = JSON.parse(await fsp.readFile(path.join(root, 'assets-manifest.json'), 'utf8'));
    if (!Array.isArray(manifest)) throw new Error('Invalid resource manifest');
    for (const file of manifest) {
      if (typeof file !== 'string' || !file.startsWith('assets/') || file.includes('..') || /[\\:\0]/.test(file)) {
        throw new Error('Invalid resource manifest path');
      }
    }
    files = [...new Set([...files, ...manifest])];
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sizes = await Promise.all(files.map(async (file) => {
    const stat = await fsp.stat(path.join(root, file));
    if (!stat.isFile() || !stat.size) throw new Error(`Missing or empty resource: ${file}`);
    return stat.size;
  }));
  const html = await fsp.readFile(path.join(root, 'index.html'), 'utf8');
  for (const section of ['sec-story', 'sec-globe', 'sec-monitoring']) {
    if (!html.includes(`id="${section}"`)) throw new Error(`Missing application section: ${section}`);
  }
  if (/<(?:script|link|img|video)\b[^>]*\b(?:src|href)\s*=\s*["']https?:\/\//i.test(html)) {
    throw new Error('Application includes an external resource');
  }
  return sizes.reduce((sum, size) => sum + size, 0);
}

module.exports = { REQUIRED_ASSETS, isAppURL, isAllowedRequest, resolveAsset, parseRange, fileResponse, validateAssets };
