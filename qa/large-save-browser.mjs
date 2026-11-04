// Run after build.mjs. Set RV_TEST_MODEL to a local GLB; it never leaves this machine.
// Optional: PLAYWRIGHT_MODULE, CHROME_PATH, RV_SOFTWARE_RENDERING=1.
// Uses a dedicated headless browser, a loopback-only server and bounded stream buffers.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const modelPath = process.env.RV_TEST_MODEL && path.resolve(process.env.RV_TEST_MODEL);
assert.ok(modelPath, 'Set RV_TEST_MODEL to the local GLB to test');
assert.equal(path.extname(modelPath).toLowerCase(), '.glb');
const modelStat = await fs.stat(modelPath);
assert.ok(modelStat.isFile() && modelStat.size > 0, 'RV_TEST_MODEL must be a nonempty file');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, '.build', 'large-save-test');
await fs.mkdir(output, { recursive: true });
const savedPath = path.join(output, 'saved-model.html');
const files = new Map([
  ['/viewer.html', path.join(root, 'dist', 'index.html')],
  ['/saved-model.html', savedPath],
]);
const timeout = 120000;
const rawChunkLimit = 786432;
const base64ChunkLimit = 4 * Math.ceil(rawChunkLimit / 3);
const startedAt = Date.now();
const checks = [];
const errors = [];
const crashes = [];
const externalRequests = [];
const memory = [];
const timings = {};
let scan;
let browser;
let resultError;

function log(message) {
  console.log(`[${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${message}`);
}

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// Parse just script tags, skipping other script bodies without retaining them.
// At most one ~1 MB base64 block plus one 256 KB read is held as text.
async function scanSavedHtml(file) {
  const hash = createHash('sha256');
  let pending = '';
  let mode = 'find';
  let metadata;
  let chunkCount = 0;
  let decodedBytes = 0;
  let maxChunkCharacters = 0;
  let maxPendingCharacters = 0;
  let priorChunkBytes;
  const scriptEnd = /<\/script\s*>/i;

  function consumeCapture(text) {
    if (mode === 'config') {
      assert.equal(metadata, undefined, 'saved HTML contains one model metadata block');
      metadata = JSON.parse(text);
    } else if (mode === 'chunk') {
      const encoded = text.trim();
      assert.ok(encoded.length > 0 && encoded.length <= base64ChunkLimit, 'base64 chunks stay bounded');
      assert.equal(encoded.length % 4, 0, 'each chunk is complete base64');
      assert.match(encoded, /^[A-Za-z0-9+/]*={0,2}$/);
      const bytes = Buffer.from(encoded, 'base64');
      assert.equal(bytes.toString('base64'), encoded, 'chunk encoding round trips exactly');
      assert.ok(bytes.length <= rawChunkLimit, 'decoded chunks stay bounded');
      if (priorChunkBytes !== undefined) assert.equal(priorChunkBytes, rawChunkLimit, 'only the last chunk may be partial');
      priorChunkBytes = bytes.length;
      hash.update(bytes);
      decodedBytes += bytes.length;
      chunkCount++;
      maxChunkCharacters = Math.max(maxChunkCharacters, encoded.length);
    }
  }

  for await (const text of createReadStream(file, { encoding: 'utf8', highWaterMark: 256 * 1024 })) {
    pending += text;
    maxPendingCharacters = Math.max(maxPendingCharacters, pending.length);
    while (true) {
      if (mode === 'find') {
        const start = pending.search(/<script\b/i);
        if (start < 0) { pending = pending.slice(-16); break; }
        pending = pending.slice(start);
        const end = pending.indexOf('>');
        if (end < 0) {
          assert.ok(pending.length < 65536, 'script tag is bounded');
          break;
        }
        const tag = pending.slice(0, end + 1);
        assert.doesNotMatch(tag, /\bsrc\s*=/i, 'saved viewer does not depend on an external script');
        mode = /\bid\s*=\s*["']rv-config["']/i.test(tag) ? 'config' :
          /\bdata-rv-model-chunk(?:\s|=|>)/i.test(tag) ? 'chunk' : 'skip';
        if (mode === 'chunk') assert.match(tag, /\btype\s*=\s*["']application\/octet-stream["']/i);
        pending = pending.slice(end + 1);
      }
      const end = scriptEnd.exec(pending);
      if (!end) {
        if (mode === 'skip') pending = pending.slice(-32);
        else assert.ok(pending.length <= (mode === 'chunk' ? base64ChunkLimit + 64 : 65536), 'captured script content is bounded');
        break;
      }
      if (mode !== 'skip') consumeCapture(pending.slice(0, end.index));
      pending = pending.slice(end.index + end[0].length);
      mode = 'find';
    }
  }
  assert.equal(mode, 'find', 'all embedded script blocks are complete');
  assert.ok(metadata, 'model metadata exists');
  assert.equal(metadata.modelEncoding, 'base64-chunks-v1');
  assert.equal(metadata.modelBase64, undefined, 'metadata does not duplicate the complete model');
  assert.equal(metadata.modelByteLength, modelStat.size);
  assert.ok(chunkCount > 0);
  assert.equal(decodedBytes, modelStat.size);
  assert.equal(chunkCount, Math.ceil(modelStat.size / rawChunkLimit));
  return { metadata, chunkCount, decodedBytes, maxChunkCharacters, maxPendingCharacters, sha256: hash.digest('hex') };
}

const server = http.createServer(async (req, res) => {
  const requested = files.get(new URL(req.url, 'http://127.0.0.1').pathname);
  if (!requested || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404); res.end('Not found'); return;
  }
  try {
    const stat = await fs.stat(requested);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') res.end();
    else await pipeline(createReadStream(requested), res);
  } catch (error) {
    if (!res.headersSent) { res.writeHead(500); res.end('Local test file unavailable'); }
    else if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE' && error.code !== 'ECONNRESET') res.destroy(error);
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;

async function loaded(page, expectedName) {
  await page.waitForFunction((name) => {
    const state = window.RhinoWebViewer?.state;
    return state?.modelLoaded && !state.loading && state.fileName === name;
  }, expectedName, { timeout });
}

async function snapshot(page, stage) {
  const sample = await page.evaluate(() => {
    const state = window.RhinoWebViewer.state;
    const heap = performance.memory;
    return {
      fileName: state.fileName,
      modelLoaded: state.modelLoaded,
      triangleCount: state.triangleCount,
      modelBounds: state.modelBounds,
      error: state.error,
      memory: heap ? { usedJSHeapSize: heap.usedJSHeapSize, totalJSHeapSize: heap.totalJSHeapSize, jsHeapSizeLimit: heap.jsHeapSizeLimit } : null,
    };
  });
  memory.push({ stage, ...sample.memory });
  delete sample.memory;
  return sample;
}

function observe(page, label) {
  page.on('pageerror', (error) => errors.push({ page: label, message: error.message }));
  page.on('crash', () => { crashes.push(label); log(`CRASH: ${label}`); });
}

try {
  log(`Hashing local model (${modelStat.size} bytes) with a stream`);
  const sourceSha256 = await hashFile(modelPath);
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    headless: true,
    args: process.env.RV_SOFTWARE_RENDERING === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
  });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, writable: true, value: undefined });
  });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (/^https?:/.test(url) && !url.startsWith(origin + '/')) {
      externalRequests.push(url); return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  observe(page, 'original');
  await page.goto(origin + '/viewer.html', { timeout });
  await page.waitForFunction(() => window.RhinoWebViewer?.state.ready, null, { timeout });
  assert.equal(await page.evaluate(() => typeof window.showSaveFilePicker), 'undefined');
  await snapshot(page, 'empty-viewer');
  log('Loading the real GLB through the file input');
  let mark = Date.now();
  await page.locator('#file-input').setInputFiles(modelPath, { timeout });
  await loaded(page, path.basename(modelPath));
  timings.loadMs = Date.now() - mark;
  const original = await snapshot(page, 'model-loaded');
  assert.ok(original.triangleCount > 0);
  assert.equal(await page.locator('#error-panel').isVisible(), false);
  checks.push('the real model loads through the file input');

  log('Saving through the actual browser download fallback');
  mark = Date.now();
  let lastProgress = '';
  const progressTimer = setInterval(async () => {
    try {
      const progress = await page.locator('#save-page').textContent({ timeout: 4000 });
      if (progress !== lastProgress) { lastProgress = progress; log(progress); }
    } catch { /* Main test reports crashes and timeouts. */ }
  }, 10000);
  let download;
  try {
    [download] = await Promise.all([
      page.waitForEvent('download', { timeout }),
      page.getByRole('button', { name: '保存模型网页', exact: true }).click({ timeout }),
    ]);
  } finally { clearInterval(progressTimer); }
  await download.saveAs(savedPath);
  assert.equal(await download.failure(), null);
  await page.waitForFunction(() => !window.RhinoWebViewer.state.saving, null, { timeout });
  timings.saveMs = Date.now() - mark;
  await snapshot(page, 'saved');
  checks.push('the real browser download completes without a file picker');
  log('Closing the original model page before opening the saved copy');
  await page.close();

  log('Checking saved chunks and original GLB SHA-256 with bounded buffers');
  scan = await scanSavedHtml(savedPath);
  assert.equal(scan.sha256, sourceSha256, 'saved model bytes equal the original GLB exactly');
  assert.equal(scan.metadata.fileName, original.fileName);
  checks.push('saved chunks are at most 1 MB of base64 and reproduce the exact original GLB');

  log('Opening the saved HTML in a fresh page');
  mark = Date.now();
  const reopenedPage = await context.newPage();
  observe(reopenedPage, 'reopened');
  await reopenedPage.goto(origin + '/saved-model.html', { timeout, waitUntil: 'domcontentloaded' });
  await loaded(reopenedPage, original.fileName);
  timings.reopenMs = Date.now() - mark;
  const reopened = await snapshot(reopenedPage, 'reopened');
  assert.equal(reopened.modelLoaded, true);
  assert.equal(reopened.fileName, original.fileName);
  assert.equal(reopened.triangleCount, original.triangleCount);
  assert.deepEqual(reopened.modelBounds, original.modelBounds);
  assert.equal(await reopenedPage.locator('#error-panel').isVisible(), false);
  assert.equal(await reopenedPage.locator('#save-page').isEnabled(), true);
  checks.push('reopened saved HTML preserves filename, triangles and bounds');
  assert.equal(await reopenedPage.locator('script[data-rv-model-chunk]').count(), 0, 'decoded chunks do not remain in the page');
  log('Saving the reopened model through a real writable file stream');
  await reopenedPage.evaluate(() => {
    window.showSaveFilePicker = async () => {
      const directory = await navigator.storage.getDirectory();
      return directory.getFileHandle('large-native-save.html', { create: true });
    };
  });
  mark = Date.now();
  await reopenedPage.getByRole('button', { name: '保存模型网页', exact: true }).click({ timeout });
  await reopenedPage.waitForFunction(() => !window.RhinoWebViewer.state.saving, null, { timeout });
  const nativeSize = await reopenedPage.evaluate(async () => {
    const file = await (await (await navigator.storage.getDirectory()).getFileHandle('large-native-save.html')).getFile();
    const link = document.createElement('a');
    link.id = 'qa-native-download';
    link.href = URL.createObjectURL(file);
    link.download = 'native-saved-model.html';
    link.textContent = 'Download saved validation file';
    link.style.cssText = 'position:fixed;left:0;top:0;z-index:10000;background:white;padding:12px';
    document.body.appendChild(link);
    return file.size;
  });
  assert.ok(nativeSize > modelStat.size);
  timings.nativeSaveMs = Date.now() - mark;
  const [nativeDownload] = await Promise.all([
    reopenedPage.waitForEvent('download', { timeout }),
    reopenedPage.locator('#qa-native-download').click({ timeout }),
  ]);
  const nativePath = path.join(output, 'native-saved-model.html');
  await nativeDownload.saveAs(nativePath);
  const nativeScan = await scanSavedHtml(nativePath);
  assert.equal(nativeScan.sha256, sourceSha256);
  assert.equal(nativeScan.metadata.fileName, original.fileName);
  checks.push('reopened model saves again through a writable stream with identical original GLB bytes');
  await snapshot(reopenedPage, 'saved-again-native');
  assert.deepEqual(crashes, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  checks.push('no page crash, uncaught error or external HTTP request');
  log(`PASS: ${checks.length} checks; ${scan.chunkCount} chunks; SHA-256 verified`);
} catch (error) {
  resultError = error;
  log(`FAIL: ${error.message}`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  const results = {
    passed: !resultError, checks, model: { name: path.basename(modelPath), bytes: modelStat.size },
    scan, timings, memory, errors, crashes, externalRequests,
    error: resultError ? { message: resultError.message, stack: resultError.stack } : undefined,
  };
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.passed, checks: checks.length, timings, output }));
}
if (resultError) throw resultError;
