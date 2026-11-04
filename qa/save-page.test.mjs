import test from 'node:test';
import assert from 'node:assert/strict';
import { safeConfigJson, modelPageFileName, createModelPageBlob, modelPageParts,
  decodeModelChunk, writeModelPage, MODEL_CHUNK_BYTES } from '../viewer/save-page.js';

const shell = { prefix: '<html>', suffix: '</html>' };
function unpackSmallPage(html, length) {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const match of html.matchAll(/<script type="application\/octet-stream" data-rv-model-chunk>([A-Za-z0-9+/=]+)<\/script>/g)) {
    offset = decodeModelChunk(match[1], bytes, offset);
  }
  assert.equal(offset, length);
  return bytes;
}

for (const length of [1, 2, 3, 49151, 49152, 49153, 190001, MODEL_CHUNK_BYTES - 1, MODEL_CHUNK_BYTES, MODEL_CHUNK_BYTES + 1, 2 * MODEL_CHUNK_BYTES + 2]) {
  test(`saving retains all ${length} model bytes across Base64 boundaries`, async () => {
    const original = Uint8Array.from({ length }, (_, i) => (i * 31 + 17) % 256);
    const source = length % 2 ? new Blob([original]) : original.buffer;
    const saved = await createModelPageBlob(shell, source);
    assert.deepEqual(unpackSmallPage(await saved.text(), length), original);
  });
}

test('model names cannot break out of the embedded JSON script', () => {
  const title = '中文 </script><script>alert("x")</script> & > \u2028\u2029 🪑';
  const text = safeConfigJson({ title, fileName: title + '.glb' });
  assert.doesNotMatch(text, /[<>&\u2028\u2029]/);
  assert.equal(JSON.parse(text).title, title);
});

test('saving a replacement model does not reuse the first model', async () => {
  const first = new Uint8Array([1, 2, 3]).buffer;
  const second = new Uint8Array([6, 7, 8, 9]).buffer;
  const firstPage = await (await createModelPageBlob(shell, first)).text();
  const secondPage = await (await createModelPageBlob(shell, second)).text();
  assert.notEqual(firstPage, secondPage);
  assert.deepEqual([...unpackSmallPage(secondPage, 4)], [6, 7, 8, 9]);
});

test('empty model data cannot be saved', async () => {
  await assert.rejects(createModelPageBlob(shell, new ArrayBuffer(0)), /先打开/);
});

test('download filenames are usable on Windows and end in HTML', () => {
  assert.equal(modelPageFileName('客户:模型/新版本?'), '客户_模型_新版本_-360预览.html');
  assert.equal(modelPageFileName('CON'), 'CON-360预览.html');
  assert.equal(modelPageFileName(' . '), '模型-360预览.html');
  assert.ok(modelPageFileName('x'.repeat(300)).length < 130);
});

test('streamed writes are bounded and complete only after the final write', async () => {
  const source = new Blob([new Uint8Array(MODEL_CHUNK_BYTES * 3 + 5)]);
  let writes = 0, maximum = 0, closed = false, completed = 0;
  const writable = {
    async write(part) { assert.equal(closed, false); writes++; maximum = Math.max(maximum, part.length); },
    async close() { closed = true; },
    async abort() { assert.fail('valid writes must not abort'); },
  };
  await writeModelPage(writable, shell, source, (done) => { completed = done; });
  assert.equal(writes, 6);
  assert.ok(maximum < 1024 * 1024 + 100);
  assert.equal(closed, true);
  assert.equal(completed, source.size);
});

test('failed writes abort without committing the destination', async () => {
  let aborted = false, closed = false;
  const error = new Error('Disk full');
  await assert.rejects(writeModelPage({
    async write() { throw error; },
    async close() { closed = true; },
    async abort() { aborted = true; },
  }, shell, new Uint8Array([1]).buffer), error);
  assert.equal(aborted, true);
  assert.equal(closed, false);
});

test('damaged or overflowing model chunks are rejected', () => {
  assert.throws(() => decodeModelChunk('AA?=', new Uint8Array(3), 0), /损坏/);
  assert.throws(() => decodeModelChunk('AQID', new Uint8Array(2), 0), /长度/);
});
