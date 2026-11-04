// Run after build.mjs, create-demo.mjs and qa/create-fixture.mjs.
// Requires Playwright and a Chromium browser; optional PLAYWRIGHT_MODULE and CHROME_PATH overrides.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const output = path.join(root, '.build', 'save-page-test');
await fs.mkdir(output, { recursive: true });
const pages = new Map();
for (const name of ['demo.html', 'index.html']) pages.set('/' + name, await fs.readFile(path.join(dist, name)));
pages.set('/viewer/index.template.html', await fs.readFile(path.join(root, 'viewer', 'index.template.html')));
pages.set('/artifacts/viewer.html', await fs.readFile(path.join(dist, 'index.html')));
const server = http.createServer((req, res) => {
  const body = pages.get(new URL(req.url, 'http://localhost').pathname);
  res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body || 'Not found');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const checks = [];
const errors = [];
const externalRequests = [];
try {
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    headless: true,
    args: process.env.RV_SOFTWARE_RENDERING === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
  });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
  // Test the actual download path; native picker behavior is covered separately below.
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (/^https?:/.test(url) && !url.startsWith(origin + '/')) {
      externalRequests.push(url); return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  async function loaded(tab, name) {
    await tab.waitForFunction((expected) => window.RhinoWebViewer?.state.modelLoaded &&
      !window.RhinoWebViewer.state.loading && (!expected || window.RhinoWebViewer.state.fileName === expected), name, { timeout: 30000 });
  }
  async function save(tab, route, expectedBytes, keyboard = false) {
    const pending = tab.waitForEvent('download', { timeout: 20000 });
    if (keyboard) await tab.keyboard.press('Control+s');
    else await tab.getByRole('button', { name: '保存模型网页', exact: true }).click();
    const download = await pending;
    const target = path.join(output, route.slice(1));
    await download.saveAs(target);
    const html = await fs.readFile(target, 'utf8');
    const match = html.match(/<script id="rv-config" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(match, 'saved page has embedded model configuration');
    const config = JSON.parse(match[1]);
    assert.equal(config.modelEncoding, 'base64-chunks-v1');
    const chunks = [...html.matchAll(/<script type="application\/octet-stream" data-rv-model-chunk>([A-Za-z0-9+/=]+)<\/script>/g)];
    assert.deepEqual(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk[1], 'base64'))), expectedBytes);
    assert.equal(config.modelByteLength, expectedBytes.length);
    assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i);
    pages.set(route, Buffer.from(html));
    return { config, downloadName: download.suggestedFilename() };
  }
  await page.goto(origin + '/viewer/index.template.html');
  assert.equal(await page.getByRole('heading', { name: '这是开发模板，请打开完整的模型查看器' }).isVisible(), true);
  assert.equal(await page.locator('#app').isVisible(), false);
  await page.screenshot({ path: path.join(output, 'source-template-help.png') });
  await page.getByRole('link', { name: '打开完整的模型查看器 →' }).click();
  checks.push('opening the source template shows help and leads to the packaged viewer');
  await page.waitForFunction(() => window.RhinoWebViewer?.state.ready);
  assert.equal(await page.locator('#save-page').isDisabled(), true);
  checks.push('empty viewer cannot save a stale/demo model');

  await page.goto(origin + '/demo.html');
  await loaded(page);
  const demoBytes = await fs.readFile(path.join(dist, 'demo.glb'));
  const textureBytes = await fs.readFile(path.join(dist, 'texture-test.glb'));
  const initial = await page.evaluate(() => ({ ...window.RhinoWebViewer.state }));
  await page.evaluate(() => {
    window.pendingFileRead = new Promise((resolve) => { window.finishFileRead = resolve; });
    window.pendingFileLoad = window.RhinoWebViewer.loadFile({ name: '读取中.glb', arrayBuffer: () => window.pendingFileRead });
  });
  assert.equal(await page.locator('#save-page').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.RhinoWebViewer.saveModelPage()), false);
  await page.evaluate((bytes) => { window.finishFileRead(new Uint8Array(bytes).buffer); return window.pendingFileLoad; }, [...demoBytes]);
  await loaded(page, '读取中.glb');
  checks.push('saving is disabled while a new file is being read');
  const fileInput = page.locator('#file-input');
  await fileInput.setInputFiles(path.join(dist, 'texture-test.glb'));
  await loaded(page, 'texture-test.glb');
  const replacement = await page.evaluate(() => ({ ...window.RhinoWebViewer.state }));
  assert.notEqual(replacement.triangleCount, initial.triangleCount);
  const saved = await save(page, '/saved-texture.html', textureBytes);
  assert.equal(saved.config.fileName, 'texture-test.glb');
  assert.equal(saved.downloadName, 'texture-test-360预览.html');
  checks.push('open replacement GLB then save downloads the replacement with identical geometry and PNG bytes');

  const fresh = await context.newPage();
  fresh.on('pageerror', (error) => errors.push(error.message));
  await fresh.goto(origin + '/saved-texture.html');
  await loaded(fresh, 'texture-test.glb');
  const reopened = await fresh.evaluate(() => ({ state: { ...window.RhinoWebViewer.state }, render: window.RhinoWebViewer.getRenderInfo() }));
  assert.equal(reopened.state.triangleCount, replacement.triangleCount);
  assert.deepEqual(reopened.state.modelBounds, replacement.modelBounds);
  assert.ok(reopened.render.textures > 0);
  assert.equal(await fresh.locator('#save-page').isEnabled(), true);
  assert.equal(await fresh.locator('#error-panel').isVisible(), false);
  await fresh.screenshot({ path: path.join(output, 'saved-model-desktop.png') });
  checks.push('a fresh page opens the saved replacement with matching bounds, triangles and textures');

  await fresh.reload();
  await loaded(fresh, 'texture-test.glb');
  await save(fresh, '/saved-again.html', textureBytes, true);
  checks.push('reload and Ctrl+S preserve the same replacement model');

  const unsafeName = '</script><script>window.injected=true</script>&中文.glb';
  await fresh.locator('#file-input').setInputFiles({ name: unsafeName, mimeType: 'model/gltf-binary', buffer: demoBytes });
  await loaded(fresh, unsafeName);
  await save(fresh, '/saved-second-model.html', demoBytes);
  await page.goto(origin + '/saved-second-model.html');
  await loaded(page, unsafeName);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(await page.evaluate(() => window.RhinoWebViewer.state.triangleCount), initial.triangleCount);
  checks.push('a saved page can replace and save a second model; hostile model names remain plain text');

  await page.locator('#file-input').setInputFiles(path.join(dist, 'bad-model.glb'));
  await page.waitForFunction(() => !window.RhinoWebViewer.state.loading && window.RhinoWebViewer.state.error);
  await save(page, '/saved-after-failure.html', demoBytes);
  checks.push('a failed replacement retains the last successfully displayed model for saving');

  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(origin + '/saved-texture.html');
  await loaded(mobile, 'texture-test.glb');
  for (const id of ['open-file', 'save-page']) {
    const bounds = await mobile.locator('#' + id).boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391 && bounds.y >= 0);
  }
  await mobile.screenshot({ path: path.join(output, 'saved-model-mobile.png') });
  checks.push('open and save controls fit a 390-pixel screen');
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  checks.push('no uncaught page errors or external HTTP requests');
  await fresh.evaluate(() => { window.showSaveFilePicker = async () => { throw new DOMException('Cancelled', 'AbortError'); }; });
  let cancelledDownloads = 0;
  fresh.on('download', () => cancelledDownloads++);
  await fresh.getByRole('button', { name: '保存模型网页', exact: true }).click();
  await fresh.waitForFunction(() => !window.RhinoWebViewer.state.saving);
  assert.equal(await fresh.locator('#save-page').isEnabled(), true);
  assert.equal(cancelledDownloads, 0);
  checks.push('cancelling the native save dialog resets controls without a fallback download');

  // Exercise a real browser FileSystemWritableFileStream via a private test-profile handle.
  await fresh.evaluate(() => {
    window.showSaveFilePicker = async () => {
      const directory = await navigator.storage.getDirectory();
      return directory.getFileHandle('native-save-test.html', { create: true });
    };
  });
  await fresh.getByRole('button', { name: '保存模型网页', exact: true }).click();
  await fresh.waitForFunction(() => !window.RhinoWebViewer.state.saving);
  const nativeMetadata = await fresh.evaluate(async () => {
    const file = await (await (await navigator.storage.getDirectory()).getFileHandle('native-save-test.html')).getFile();
    const html = await file.text();
    const match = html.match(/<script id="rv-config" type="application\/json">([\s\S]*?)<\/script>/);
    return { size: file.size, config: JSON.parse(match[1]) };
  });
  assert.equal(nativeMetadata.config.modelByteLength, demoBytes.length);
  assert.ok(nativeMetadata.size > demoBytes.length);
  checks.push('native file writing completes through a real browser writable file stream');
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, externalRequests }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, output }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
