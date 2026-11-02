import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

// Run after build.mjs. Every model, texture and viewer byte stays on disk.
class FileReaderPolyfill {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((value) => { this.result = value; this.onload?.(); this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((value) => { this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`; this.onload?.(); this.onloadend?.(); }); }
}
globalThis.FileReader = FileReaderPolyfill;
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, 'dist');
await fs.mkdir(output, { recursive: true });

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function makeCheckerPng(width = 128, height = 128) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = ((Math.floor(x / 16) + Math.floor(y / 16)) % 2) === 0;
      const [r, g, b] = tile ? [42, 104, 71] : [245, 230, 195];
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      rows[offset] = r; rows[offset + 1] = g; rows[offset + 2] = b; rows[offset + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function unpackGlb(bytes) {
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const binHeader = 20 + jsonLength;
  const binLength = bytes.readUInt32LE(binHeader);
  return { json, bin: bytes.subarray(binHeader + 8, binHeader + 8 + binLength) };
}
function packGlb(json, bin) {
  const rawJson = Buffer.from(JSON.stringify(json));
  const jsonBytes = Buffer.alloc(Math.ceil(rawJson.length / 4) * 4, 0x20); rawJson.copy(jsonBytes);
  const binBytes = Buffer.alloc(Math.ceil(bin.length / 4) * 4); bin.copy(binBytes);
  const outputBytes = Buffer.alloc(12 + 8 + jsonBytes.length + 8 + binBytes.length);
  outputBytes.writeUInt32LE(0x46546c67, 0); outputBytes.writeUInt32LE(2, 4); outputBytes.writeUInt32LE(outputBytes.length, 8);
  outputBytes.writeUInt32LE(jsonBytes.length, 12); outputBytes.writeUInt32LE(0x4e4f534a, 16); jsonBytes.copy(outputBytes, 20);
  const binHeader = 20 + jsonBytes.length;
  outputBytes.writeUInt32LE(binBytes.length, binHeader); outputBytes.writeUInt32LE(0x004e4942, binHeader + 4); binBytes.copy(outputBytes, binHeader + 8);
  return outputBytes;
}

const scene = new THREE.Scene();
const checker = new THREE.MeshStandardMaterial({ name: 'Embedded PNG checker', color: 0xffffff, roughness: .55, metalness: .02 });
const translucent = new THREE.MeshStandardMaterial({ name: 'Transparent blue shell', color: 0x69c5e6, roughness: .2, transparent: true, opacity: .26, metalness: .03, side: THREE.DoubleSide });
const warm = new THREE.MeshStandardMaterial({ name: 'Orange inside transparent shell', color: 0xe17b32, roughness: .4 });
const cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), checker); cube.name = 'PNG textured cube'; cube.position.set(-1.3, .8, 0); scene.add(cube);
const shell = new THREE.Mesh(new THREE.BoxGeometry(1.65, 1.65, 1.65), translucent); shell.name = 'Alpha 0.26 blue shell'; shell.position.set(1.25, .875, 0); scene.add(shell);
const sphere = new THREE.Mesh(new THREE.SphereGeometry(.55, 40, 28), warm); sphere.name = 'Orange sphere visible through blue shell'; sphere.position.copy(shell.position); scene.add(sphere);
const binary = Buffer.from(await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true }));
const { json, bin } = unpackGlb(binary);
const png = makeCheckerPng();
const imageBufferView = json.bufferViews.length;
json.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: png.length });
json.images = [{ name: 'Offline green and cream checker PNG', mimeType: 'image/png', bufferView: imageBufferView }];
json.samplers = [{ magFilter: 9728, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
json.textures = [{ sampler: 0, source: 0 }];
json.materials.find((material) => material.name === checker.name).pbrMetallicRoughness.baseColorTexture = { index: 0, texCoord: 0 };
const allBinary = Buffer.concat([bin, png]);
json.buffers[0].byteLength = allBinary.length;
const textureModel = packGlb(json, allBinary);
const template = await fs.readFile(path.join(output, 'ViewerTemplate.html'), 'utf8');
if (template.split('__RV_CONFIG_JSON__').length !== 2) throw new Error('Build the official ViewerTemplate.html first.');
async function writeFixture(stem, title, model) {
  const config = { title, modelBase64: model.toString('base64'), fileName: `${stem}.glb` };
  const safeJson = JSON.stringify(config).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  await fs.writeFile(path.join(output, `${stem}.html`), template.replace('__RV_CONFIG_JSON__', () => safeJson));
  await fs.writeFile(path.join(output, `${stem}.glb`), model);
  return path.join(output, `${stem}.html`);
}

const results = [];
results.push(await writeFixture('texture-test', '贴图与透明材质 · 离线测试', textureModel));
results.push(await writeFixture('bad-model', '损坏模型 · 错误提示测试', textureModel.subarray(0, 64)));
const externalJson = structuredClone(json);
externalJson.images = [{ name: 'External URI must be blocked before loading', mimeType: 'image/png', uri: 'https://example.com/blocked-texture.png' }];
results.push(await writeFixture('external-resource', '外部资源 · 离线拦截测试', packGlb(externalJson, allBinary)));
const badImageBinary = Buffer.from(allBinary);
badImageBinary.fill(0, bin.length, bin.length + Math.min(png.length, 32));
results.push(await writeFixture('bad-texture', '损坏贴图 · 错误提示测试', packGlb(json, badImageBinary)));
console.log(JSON.stringify({ files: results, textureBytes: png.length, modelBytes: textureModel.length }, null, 2));
