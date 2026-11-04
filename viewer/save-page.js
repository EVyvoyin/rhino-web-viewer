export const MODEL_CHUNK_BYTES = 3 * 256 * 1024;
export const MODEL_ENCODING = 'base64-chunks-v1';

export function safeConfigJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function modelSourceSize(source) {
  const size = source instanceof Blob ? source.size : source instanceof ArrayBuffer ? source.byteLength : 0;
  if (!size) throw new Error('请先打开一个模型，再保存模型网页。');
  return size;
}

export function encodeModelChunk(bytes) {
  const pieces = [];
  // Keep argument counts small and intermediate strings bounded to one model chunk.
  for (let offset = 0; offset < bytes.length; offset += 3 * 16384) {
    pieces.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 3 * 16384))));
  }
  return pieces.join('');
}

export function decodeModelChunk(text, output, offset) {
  if (text.length > MODEL_CHUNK_BYTES * 4 / 3 || !text.length || text.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('网页中的模型数据块已损坏，请重新保存。');
  const binary = atob(text);
  if (offset + binary.length > output.length) throw new Error('网页中的模型长度不正确，请重新保存。');
  for (let i = 0; i < binary.length; i++) output[offset + i] = binary.charCodeAt(i);
  return offset + binary.length;
}

export function modelPageFileName(title) {
  const stem = String(title || '模型').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .slice(0, 100).replace(/[. ]+$/g, '') || '模型';
  return `${stem}-360预览.html`;
}

export function createPageShell(templateRoot, metadata, modelByteLength) {
  // templateRoot contains only the small viewer; model text must never enter this DOM.
  const root = templateRoot.cloneNode(true);
  const config = root.querySelector('#rv-config');
  if (!config) throw new Error('网页模板不完整，请重新打开完整的查看器文件。');
  config.textContent = safeConfigJson({ title: metadata.title, fileName: metadata.fileName,
    modelEncoding: MODEL_ENCODING, modelByteLength });
  root.querySelector('title').textContent = `${metadata.title || '模型预览'} · 模型预览`;
  const marker = `rv-model-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  config.after(root.ownerDocument.createComment(marker));
  const html = '<!doctype html>\n' + root.outerHTML;
  const token = `<!--${marker}-->`;
  const at = html.indexOf(token);
  if (at < 0) throw new Error('无法创建模型网页。');
  return { prefix: html.slice(0, at), suffix: html.slice(at + token.length) };
}

export async function* modelPageParts(shell, source, onProgress = () => {}) {
  const size = modelSourceSize(source);
  yield shell.prefix;
  onProgress(0, size);
  for (let offset = 0; offset < size; offset += MODEL_CHUNK_BYTES) {
    const length = Math.min(MODEL_CHUNK_BYTES, size - offset);
    const bytes = source instanceof Blob
      ? new Uint8Array(await source.slice(offset, offset + length).arrayBuffer())
      : new Uint8Array(source, offset, length);
    // Each part becomes a bounded write or an independent Blob, never one giant string.
    yield `<script type="application/octet-stream" data-rv-model-chunk>${encodeModelChunk(bytes)}</script>\n`;
    onProgress(offset + length, size);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  yield shell.suffix;
}

export async function createModelPageBlob(shell, source, onProgress) {
  const parts = [];
  for await (const part of modelPageParts(shell, source, onProgress)) parts.push(new Blob([part]));
  return new Blob(parts, { type: 'text/html;charset=utf-8' });
}

export async function writeModelPage(writable, shell, source, onProgress) {
  try {
    for await (const part of modelPageParts(shell, source, onProgress)) await writable.write(part);
    await writable.close();
  } catch (error) {
    try { await writable.abort(); } catch { /* Preserve the original write failure. */ }
    throw error;
  }
}
