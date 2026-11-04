import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createPageShell, createModelPageBlob, writeModelPage, modelSourceSize,
  modelPageFileName, decodeModelChunk, MODEL_ENCODING } from './save-page.js';

// This bundle is embedded in the exported HTML. It never requests a remote asset.
const $ = (id) => document.getElementById(id);
const app = $('app');
// Detach data before copying the shell: cloning a 200 MB model-bearing DOM can exhaust memory.
const embeddedConfigNode = $('rv-config');
const emptyConfigNode = embeddedConfigNode.cloneNode(false);
emptyConfigNode.textContent = '{}';
embeddedConfigNode.replaceWith(emptyConfigNode);
const embeddedModelChunks = [...document.querySelectorAll('script[data-rv-model-chunk]')];
for (const node of embeddedModelChunks) node.remove();
const pageTemplate = document.documentElement.cloneNode(true);
const state = {
  ready: false, modelLoaded: false, loading: false, saving: false, error: null, title: '',
  fileName: '', fileSize: 0, modelBounds: null, triangleCount: 0,
  theme: 'light', autoRotate: false, currentView: 'perspective', webglAvailable: false,
};
let scene, renderer, camera, controls, modelRoot, ground, keyLight, environmentTarget;
let currentModel = null, loadSequence = 0, toastTimer, transition = null;
let currentModelSource = null;
let fitDistance = 12, previousFrame = 0, disposed = false, resizeObserver;
const targetOrigin = new THREE.Vector3();
const displaySize = 6.4;
const modelHalf = new THREE.Vector3(3.2, 3.2, 3.2);
const cameraDirections = {
  perspective: new THREE.Vector3(1, .64, 1).normalize(),
  front: new THREE.Vector3(0, 0, 1),
  side: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, 1, .0001).normalize(),
};

function setStatus(message) { $('loading-text').textContent = message; }
function notify(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3400);
}
function showError(message, title = '暂时无法显示模型') {
  state.error = message;
  $('error-title').textContent = title;
  $('error-message').textContent = message;
  $('error-panel').hidden = false;
}
function setLoading(loading) {
  state.loading = loading;
  $('loading-panel').hidden = !loading;
  $('empty-state').hidden = loading || state.modelLoaded;
  $('open-file').disabled = loading || state.saving;
  $('save-page').disabled = loading || state.saving || !currentModelSource;
}
function sizeLabel(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}
function fileTitle(name) { return (name || '模型预览').replace(/\.(glb|3dm)$/i, ''); }
function setTitle(title) {
  state.title = title || '模型预览';
  $('model-title').textContent = state.title;
  $('model-title').title = state.title;
  document.title = `${state.title} · 模型预览`;
}
function setAutoRotate(enabled) {
  state.autoRotate = Boolean(enabled) && state.modelLoaded;
  if (controls) controls.autoRotate = state.autoRotate;
  $('auto-rotate').setAttribute('aria-pressed', String(state.autoRotate));
  return state.autoRotate;
}
function updateViewButtons(view) {
  state.currentView = view;
  for (const button of document.querySelectorAll('[data-view]')) {
    const selected = button.dataset.view === view;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
}

function updateFitDistance() {
  if (!camera) return;
  // A bounding sphere provides a stable fit for every standard view, including tall models.
  const radius = Math.max(modelHalf.length(), .001);
  const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect);
  const halfFov = Math.min(verticalHalfFov, horizontalHalfFov);
  fitDistance = radius / Math.sin(halfFov) * 1.22;
  controls.minDistance = Math.max(radius * .035, .025);
  controls.maxDistance = fitDistance * 8;
  camera.near = .002;
  camera.far = Math.max(200, fitDistance * 15);
  camera.updateProjectionMatrix();
}
function setView(view = 'perspective', animate = true) {
  if (!camera || !state.modelLoaded) return false;
  const direction = cameraDirections[view] || cameraDirections.perspective;
  updateFitDistance();
  setAutoRotate(false);
  updateViewButtons(view in cameraDirections ? view : 'perspective');
  const destination = direction.clone().multiplyScalar(fitDistance).add(targetOrigin);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate || reducedMotion) {
    transition = null;
    camera.position.copy(destination);
    camera.up.set(0, 1, 0);
    controls.target.copy(targetOrigin);
    controls.update();
  } else {
    transition = {
      start: performance.now(), duration: 600,
      fromPosition: camera.position.clone(), toPosition: destination,
      fromTarget: controls.target.clone(), toTarget: targetOrigin.clone(),
    };
  }
  return true;
}
function resetView(animate = true) { return setView('perspective', animate); }

function setTheme(theme) {
  state.theme = theme === 'dark' ? 'dark' : 'light';
  const dark = state.theme === 'dark';
  app.dataset.theme = state.theme;
  if (scene) scene.background = new THREE.Color(dark ? 0x202824 : 0xeceeea);
  if (ground) ground.material.color.setHex(dark ? 0x202824 : 0xeceeea);
  if (renderer) renderer.setClearColor(dark ? 0x202824 : 0xeceeea, 1);
  $('toggle-theme').setAttribute('aria-pressed', String(dark));
  $('toggle-theme').title = dark ? '切换到浅色背景' : '切换到深色背景';
  return state.theme;
}

function disposeModel(root) {
  if (!root) return;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const items = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of items) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    if (texture.source?.data?.close) texture.source.data.close();
    texture.dispose();
  }
}

function inspectGlb(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20) {
    throw new Error('文件为空或不完整。请重新从 Rhino 导出 GLB 模型。');
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) {
    throw new Error('请选择 .glb 格式的三维模型；.3dm、.gltf 和图片不能直接打开。');
  }
  if (view.getUint32(4, true) !== 2) throw new Error('当前仅支持 glTF 2.0 格式的 GLB 模型。');
  if (view.getUint32(8, true) !== buffer.byteLength) throw new Error('GLB 文件不完整或长度不正确，请重新导出。');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength > buffer.byteLength) {
    throw new Error('GLB 文件头损坏，无法读取模型信息。');
  }
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  const extensions = new Set([...(json.extensionsRequired || []), ...(json.extensionsUsed || [])]);
  if (extensions.has('KHR_draco_mesh_compression')) throw new Error('这个模型使用 Draco 压缩。请从 Rhino 重新导出未压缩的 GLB 文件。');
  if (extensions.has('EXT_meshopt_compression')) throw new Error('这个模型使用 Meshopt 压缩。请导出未压缩的 GLB 文件后打开。');
  if (extensions.has('KHR_texture_basisu')) throw new Error('这个模型包含 KTX2 压缩贴图。请改用 JPG 或 PNG 贴图导出 GLB。');
  for (const item of [...(json.buffers || []), ...(json.images || [])]) {
    if (item.uri && !/^data:/i.test(item.uri)) {
      throw new Error('模型引用了外部文件。为了完整离线查看，请将贴图和几何数据嵌入同一个 GLB 文件。');
    }
  }
  return json;
}

function recenterLargeMeshGeometry(root) {
  // Rebase large local coordinates before GPU upload. Leave skinning, instancing,
  // morphs and nodes with children intact because their transforms are shared.
  root.traverse((object) => {
    if (!object.isMesh || object.isSkinnedMesh || object.isInstancedMesh || object.children.length ||
        !object.geometry?.attributes.position || Object.keys(object.geometry.morphAttributes || {}).length) return;
    const geometry = object.geometry;
    geometry.computeBoundingBox();
    const localCenter = geometry.boundingBox.getCenter(new THREE.Vector3());
    const localSpan = geometry.boundingBox.getSize(new THREE.Vector3()).length();
    if (localCenter.length() < Math.max(localSpan * 100, 10000)) return;
    const rebased = geometry.clone();
    rebased.translate(-localCenter.x, -localCenter.y, -localCenter.z);
    if (object.matrixAutoUpdate) object.updateMatrix();
    object.matrix.multiply(new THREE.Matrix4().makeTranslation(localCenter.x, localCenter.y, localCenter.z));
    object.matrix.decompose(object.position, object.quaternion, object.scale);
    object.geometry = rebased;
  });
}

function userError(error) {
  const message = String(error?.message || error || '');
  if (/[\u3400-\u9fff]/.test(message)) return message;
  if (/out of memory|allocation|array buffer/i.test(message)) return '设备内存不足。请在 Rhino 中降低网格精度或分批导出较小的模型。';
  if (/webgl|context/i.test(message)) return '浏览器的三维图形功能不可用。请使用较新的 Chrome、Edge 或 Safari，并开启硬件加速。';
  if (/texture|image|bitmap|decode/i.test(message)) return '模型贴图无法读取。请将贴图转换为 JPG 或 PNG 后重新导出 GLB。';
  return `模型数据无法解析，请确认文件是完整的 GLB。${message ? `（${message.slice(0, 220)}）` : ''}`;
}

async function loadArrayBuffer(buffer, options = {}) {
  if (state.saving) { notify('正在保存模型网页，请稍后再打开其他模型。'); return false; }
  if (!state.webglAvailable || !renderer) {
    setLoading(false);
    showError('浏览器无法启用三维图形。请使用较新的 Chrome、Edge 或 Safari，并开启硬件加速。');
    return false;
  }
  const sequence = ++loadSequence;
  state.error = null;
  $('error-panel').hidden = true;
  setLoading(true);
  setStatus('正在读取模型…');
  let gltf;
  try {
    inspectGlb(buffer);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (sequence !== loadSequence) return false;
    const manager = new THREE.LoadingManager();
    let resourceFailed = false;
    manager.onError = () => { resourceFailed = true; };
    manager.setURLModifier((url) => {
      if (/^(data:|blob:)/i.test(url)) return url;
      throw new Error('模型包含外部资源；请将所有资源嵌入 GLB 文件后重新打开。');
    });
    const loader = new GLTFLoader(manager);
    setStatus('正在准备材质与视角…');
    gltf = await loader.parseAsync(buffer, '');
    if (sequence !== loadSequence || disposed) { disposeModel(gltf.scene); return false; }
    if (resourceFailed) throw new Error('模型内的贴图无法完整读取。请检查贴图是否损坏，并使用 JPG 或 PNG 贴图重新导出 GLB。');
    const root = gltf.scene;
    if (!root) throw new Error('这个文件不包含可显示的场景。');
    root.updateMatrixWorld(true);
    recenterLargeMeshGeometry(root);
    root.updateMatrixWorld(true);
    const originalBounds = new THREE.Box3().setFromObject(root, true);
    if (originalBounds.isEmpty()) throw new Error('模型中没有可见的几何体。请先选择曲面、实体或网格，再从 Rhino 导出。');
    const center = originalBounds.getCenter(new THREE.Vector3());
    const size = originalBounds.getSize(new THREE.Vector3());
    if (![...center, ...size].every(Number.isFinite)) throw new Error('模型包含无效坐标，无法计算视角。请在 Rhino 中检查并修复模型。');
    const maxExtent = Math.max(size.x, size.y, size.z);
    if (maxExtent <= 0) throw new Error('模型尺寸为零，无法显示。请检查导出的几何体。');
    const scale = displaySize / maxExtent;
    const normalizedRoot = new THREE.Group();
    // Keep GLTF scene transforms intact and put the world-space center at the origin.
    normalizedRoot.scale.setScalar(scale);
    normalizedRoot.position.copy(center).multiplyScalar(-scale);
    normalizedRoot.add(root);
    let triangleCount = 0, renderableCount = 0;
    root.traverse((object) => {
      if (object.isMesh) {
        renderableCount++;
        object.castShadow = true;
        object.receiveShadow = true;
        const geometry = object.geometry;
        triangleCount += Math.floor((geometry.index?.count ?? geometry.attributes.position?.count ?? 0) / 3) * (object.isInstancedMesh ? object.count : 1);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!material) continue;
          // CAD exports frequently contain open single-surface parts.
          material.side = THREE.DoubleSide;
          if ('envMapIntensity' in material) material.envMapIntensity = .85;
          material.needsUpdate = true;
        }
      }
      if (object.isLine || object.isPoints) renderableCount++;
    });
    if (!renderableCount) throw new Error('模型中没有可显示的网格、线条或点。');
    transition = null;
    if (currentModel) { modelRoot.remove(currentModel); disposeModel(currentModel); }
    currentModel = normalizedRoot;
    modelRoot.add(currentModel);
    modelHalf.copy(size).multiplyScalar(scale / 2);
    ground.position.y = -modelHalf.y - .025;
    ground.visible = true;
    keyLight.target.position.set(0, -modelHalf.y / 2, 0);
    keyLight.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
    state.modelBounds = {
      min: originalBounds.min.toArray(), max: originalBounds.max.toArray(),
      center: center.toArray(), size: size.toArray(), normalizedSize: size.clone().multiplyScalar(scale).toArray(),
    };
    state.fileName = options.fileName || 'model.glb';
    state.fileSize = buffer.byteLength;
    state.triangleCount = triangleCount;
    state.modelLoaded = true;
    setTitle(options.title || fileTitle(state.fileName));
    $('model-file-name').textContent = state.fileName;
    $('model-file-name').title = state.fileName;
    $('model-size').textContent = sizeLabel(buffer.byteLength);
    $('model-meta').hidden = false;
    $('toolbar').hidden = false;
    $('view-controls').hidden = false;
    app.classList.add('has-model');
    resetView(false);
    // GLTF animation tracks are deliberately left at their authored initial pose.
    renderer.render(scene, camera);
    // Replace the downloadable model only after the new model has loaded successfully.
    // A local File can be read in small slices when saving, without retaining another full buffer.
    currentModelSource = options.sourceFile instanceof Blob ? options.sourceFile : buffer;
    window.dispatchEvent(new CustomEvent('rhino-viewer-loaded', { detail: { ...state } }));
    return true;
  } catch (error) {
    if (gltf?.scene && (!currentModel || !currentModel.children.includes(gltf.scene))) disposeModel(gltf.scene);
    if (sequence === loadSequence) {
      console.error('[RhinoWebViewer]', error);
      showError(userError(error));
      window.dispatchEvent(new CustomEvent('rhino-viewer-error', { detail: { message: state.error } }));
    }
    return false;
  } finally {
    if (sequence === loadSequence) setLoading(false);
  }
}

async function loadFile(file) {
  if (!file) return false;
  if (state.saving) { notify('正在保存模型网页，请稍后再打开其他模型。'); return false; }
  if (!/\.glb$/i.test(file.name)) {
    showError('请选择 .glb 格式的模型。Rhino 的 .3dm 文件需要先通过导出插件转换。', '文件格式不支持');
    return false;
  }
  // Disable saving as soon as reading starts, so a large new file cannot save the old model.
  const readSequence = ++loadSequence;
  setLoading(true);
  setStatus('正在读取模型文件…');
  try {
    const buffer = await file.arrayBuffer();
    if (readSequence !== loadSequence) return false;
    const loaded = await loadArrayBuffer(buffer, { fileName: file.name, title: fileTitle(file.name), sourceFile: file });
    if (loaded) notify('模型已打开。点击“保存模型网页”，生成可发送的 HTML 文件。');
    return loaded;
  } catch (error) {
    if (readSequence === loadSequence) { setLoading(false); showError(`无法读取这个文件。${userError(error)}`); }
    return false;
  }
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !value.length) throw new Error('页面中没有嵌入模型数据，请重新导出。');
  // Decode in chunks to avoid an extra full-size binary string for large models.
  const base64 = value.replace(/^data:[^,]*;base64,/i, '').replace(/\s/g, '');
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('页面中的模型数据已损坏，请重新导出 HTML 文件。');
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(base64.length * 3 / 4 - padding);
  const chunkSize = 4 * 16384;
  let offset = 0;
  for (let i = 0; i < base64.length; i += chunkSize) {
    const decoded = atob(base64.slice(i, i + chunkSize));
    for (let j = 0; j < decoded.length; j++) bytes[offset++] = decoded.charCodeAt(j);
  }
  return bytes.buffer;
}

function resize() {
  if (!renderer || !camera) return;
  const previousFitDistance = fitDistance;
  const width = Math.max(1, app.clientWidth), height = Math.max(1, app.clientHeight);
  camera.aspect = width / height;
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  updateFitDistance();
  if (state.modelLoaded && previousFitDistance > 0) {
    // Keep the same relative zoom when rotating a phone or resizing the window.
    const ratio = fitDistance / previousFitDistance;
    camera.position.sub(controls.target).multiplyScalar(ratio).add(controls.target);
    if (transition) {
      transition.fromPosition.sub(transition.fromTarget).multiplyScalar(ratio).add(transition.fromTarget);
      transition.toPosition.sub(transition.toTarget).multiplyScalar(ratio).add(transition.toTarget);
    }
    controls.update();
  }
}

function animate(now) {
  if (disposed) return;
  requestAnimationFrame(animate);
  // Keep the last frame while reading/saving; huge scenes must not starve chunk I/O every frame.
  if (document.hidden || state.saving || state.loading || !renderer || !controls) return;
  const delta = previousFrame ? Math.min((now - previousFrame) / 1000, .05) : 1 / 60;
  previousFrame = now;
  if (transition) {
    const progress = Math.min(1, (now - transition.start) / transition.duration);
    const eased = 1 - (1 - progress) ** 3;
    camera.position.lerpVectors(transition.fromPosition, transition.toPosition, eased);
    controls.target.lerpVectors(transition.fromTarget, transition.toTarget, eased);
    if (progress === 1) transition = null;
  }
  controls.update(delta);
  renderer.render(scene, camera);
}

function initializeScene() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $('model-canvas'), antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Models are static: turning the camera does not require redrawing shadow maps.
    renderer.shadowMap.autoUpdate = false;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(36, 1, .002, 200);
    camera.position.set(10, 7, 10);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = .075;
    controls.autoRotateSpeed = .65;
    controls.screenSpacePanning = true;
    controls.zoomSpeed = .85;
    controls.rotateSpeed = .7;
    controls.addEventListener('start', () => { transition = null; updateViewButtons('custom'); });
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    environmentTarget = pmrem.fromScene(room, .04);
    scene.environment = environmentTarget.texture;
    room.dispose();
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x879285, 1.1));
    keyLight = new THREE.DirectionalLight(0xfffaf1, 2.4);
    keyLight.position.set(-6, 10, 7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -8;
    keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8;
    keyLight.shadow.camera.bottom = -8;
    keyLight.shadow.camera.near = .1;
    keyLight.shadow.camera.far = 40;
    keyLight.shadow.bias = -.00015;
    keyLight.shadow.normalBias = .025;
    keyLight.shadow.radius = 3;
    scene.add(keyLight, keyLight.target);
    const fill = new THREE.DirectionalLight(0xe3edff, 1.0);
    fill.position.set(7, 5, -5);
    scene.add(fill);
    ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0xeceeea, roughness: 1, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.visible = false;
    scene.add(ground);
    modelRoot = new THREE.Group();
    scene.add(modelRoot);
    state.webglAvailable = true;
    state.ready = true;
    setTheme('light');
    resize();
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(app);
    window.addEventListener('resize', resize);
    renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      state.webglAvailable = false;
      showError('浏览器暂停了三维图形显示。请重新打开页面；若反复发生，请降低导出精度或关闭其他占用内存的页面。', '三维显示已暂停');
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      state.webglAvailable = true;
      $('error-panel').hidden = true;
      state.error = null;
      notify('三维显示已恢复');
    });
    requestAnimationFrame(animate);
    return true;
  } catch (error) {
    state.webglAvailable = false;
    state.ready = false;
    console.error('[RhinoWebViewer] WebGL initialization:', error);
    $('empty-state').hidden = true;
    showError('此浏览器无法启用三维图形。请使用较新的 Chrome、Edge 或 Safari，并在浏览器设置中开启硬件加速。', '浏览器暂不支持三维显示');
    return false;
  }
}

function snapshot() {
  if (!renderer || !state.modelLoaded) return false;
  try {
    renderer.render(scene, camera);
    const image = renderer.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = image;
    link.download = `${state.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || '模型预览'}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    notify('已生成当前视角的 PNG 图片');
    return image;
  } catch (error) { notify('此浏览器无法保存截图，可使用设备自带的截屏功能。'); return false; }
}

async function saveModelPage() {
  if (state.loading || state.saving) return false;
  if (!currentModelSource) { notify('请先打开一个模型，再保存模型网页。'); return false; }
  state.saving = true;
  $('open-file').disabled = true;
  const button = $('save-page');
  button.disabled = true;
  button.querySelector('span').textContent = '正在保存…';
  // Capture a consistent model/name pair even if another model starts loading meanwhile.
  const source = currentModelSource;
  const metadata = { title: state.title, fileName: state.fileName };
  let url, link;
  try {
    let handle;
    // Request the destination before any asynchronous conversion, while user activation is valid.
    if (typeof window.showSaveFilePicker === 'function') {
      button.querySelector('span').textContent = '选择保存位置…';
      try {
        handle = await window.showSaveFilePicker({ suggestedName: modelPageFileName(metadata.title),
          types: [{ description: '模型网页', accept: { 'text/html': ['.html'] } }] });
      } catch (error) {
        if (error.name === 'AbortError') { notify('已取消保存'); return false; }
        if (!['SecurityError', 'NotSupportedError'].includes(error.name)) throw error;
      }
    }
    const shell = createPageShell(pageTemplate, metadata, modelSourceSize(source));
    const progress = (done, total) => { button.querySelector('span').textContent = `正在保存 ${Math.floor(done / total * 100)}%`; };
    if (handle) {
      await writeModelPage(await handle.createWritable(), shell, source, progress);
      notify(`模型网页已保存：${handle.name}。可将这个 HTML 文件发送给顾客。`);
    } else {
      const blob = await createModelPageBlob(shell, source, progress);
      url = URL.createObjectURL(blob);
      link = document.createElement('a');
      link.href = url;
      link.download = modelPageFileName(metadata.title);
      document.body.appendChild(link);
      link.click();
      notify('已生成当前模型的网页。请将新下载的 HTML 文件发送给顾客。');
    }
    return true;
  } catch (error) {
    console.error('[RhinoWebViewer] Save page:', error);
    notify('模型网页保存失败，请重试；大模型可先降低网格精度。');
    return false;
  } finally {
    link?.remove();
    if (url) setTimeout(() => URL.revokeObjectURL(url), 60000);
    state.saving = false;
    $('open-file').disabled = state.loading;
    button.querySelector('span').textContent = '保存模型网页';
    button.disabled = state.loading || !currentModelSource;
  }
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (app.requestFullscreen) await app.requestFullscreen();
    else notify('此浏览器不支持全屏按钮，可使用横屏查看。');
  } catch { notify('此浏览器未允许进入全屏，可使用横屏查看。'); }
}

for (const id of ['open-file', 'empty-open', 'error-open']) $(id).addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) await loadFile(file);
});
$('dismiss-error').addEventListener('click', () => { $('error-panel').hidden = true; });
$('reset-view').addEventListener('click', () => resetView());
$('auto-rotate').addEventListener('click', () => setAutoRotate(!state.autoRotate));
$('toggle-theme').addEventListener('click', () => setTheme(state.theme === 'light' ? 'dark' : 'light'));
$('take-snapshot').addEventListener('click', snapshot);
$('save-page').addEventListener('click', saveModelPage);
$('fullscreen').addEventListener('click', toggleFullscreen);
if (!app.requestFullscreen) { $('fullscreen').classList.add('unsupported'); $('fullscreen').title = '此浏览器不支持全屏按钮'; }
document.addEventListener('fullscreenchange', () => {
  $('fullscreen').setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
  $('fullscreen').title = document.fullscreenElement ? '退出全屏' : '全屏查看';
});
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => setView(button.dataset.view));
let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault(); dragDepth++; $('drop-overlay').hidden = false;
  }
});
window.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
});
window.addEventListener('dragleave', (event) => { event.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('drop-overlay').hidden = true; } });
window.addEventListener('drop', async (event) => {
  event.preventDefault(); dragDepth = 0; $('drop-overlay').hidden = true;
  const files = [...(event.dataTransfer?.files || [])];
  if (!files.length) return;
  if (files.length > 1) notify('每次预览一个模型，已打开第一个文件');
  await loadFile(files[0]);
});
window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveModelPage();
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
  if (event.key.toLowerCase() === 'r') resetView();
  if (event.key === 'Escape') { $('drop-overlay').hidden = true; dragDepth = 0; }
});

window.RhinoWebViewer = {
  state,
  get modelLoaded() { return state.modelLoaded; },
  get modelBounds() { return state.modelBounds; },
  resetView, setView, setTheme, setAutoRotate, loadFile, loadArrayBuffer, snapshot, saveModelPage,
  getCamera() { return camera ? { position: camera.position.toArray(), target: controls.target.toArray(), aspect: camera.aspect, fitDistance } : null; },
  getRenderInfo() { return renderer ? { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures } : null; },
};

function clearEmbeddedChunks() {
  for (const node of embeddedModelChunks) if (node) node.textContent = '';
  embeddedModelChunks.length = 0;
}

(async () => {
  let config;
  try { config = JSON.parse(embeddedConfigNode.textContent || '{}'); }
  catch { config = {}; showError('页面配置信息损坏，仍可通过“打开模型”选择 GLB 文件。'); }
  embeddedConfigNode.textContent = '';
  setTitle(config.title || fileTitle(config.fileName));
  if (!initializeScene()) { clearEmbeddedChunks(); config.modelBase64 = ''; return; }
  if (config.modelBase64 || config.modelEncoding === MODEL_ENCODING) {
    const embeddedSequence = ++loadSequence;
    setLoading(true);
    setStatus('正在读取内嵌模型…');
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      if (embeddedSequence !== loadSequence) return;
      let buffer;
      if (config.modelEncoding === MODEL_ENCODING) {
        if (!Number.isSafeInteger(config.modelByteLength) || config.modelByteLength <= 0 || !embeddedModelChunks.length) {
          throw new Error('网页中的模型数据不完整，请重新保存。');
        }
        const bytes = new Uint8Array(config.modelByteLength);
        let offset = 0;
        for (let i = 0; i < embeddedModelChunks.length; i++) {
          const node = embeddedModelChunks[i];
          let text = node.textContent;
          node.textContent = '';
          embeddedModelChunks[i] = null;
          offset = decodeModelChunk(text, bytes, offset);
          text = null;
          setStatus(`正在读取内嵌模型 ${Math.floor(offset / bytes.length * 100)}%…`);
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (embeddedSequence !== loadSequence) return;
        }
        if (offset !== bytes.length) throw new Error('网页中的模型长度不正确，请重新保存。');
        buffer = bytes.buffer;
      } else {
        buffer = decodeBase64(config.modelBase64);
      }
      config.modelBase64 = '';
      await loadArrayBuffer(buffer, { title: config.title, fileName: config.fileName || `${config.title || '模型'}.glb` });
    } catch (error) {
      if (embeddedSequence === loadSequence) { setLoading(false); showError(userError(error)); }
    }
    finally {
      clearEmbeddedChunks();
      config.modelBase64 = '';
    }
  } else clearEmbeddedChunks();
})();
