# 验证记录 · 2026-10-29

## 环境

- Windows，Rhino 8.19.25132.01001 本地 RhinoCommon API。
- C# 编译使用 Windows .NET Framework 编译器；运行兼容性还需 Rhino 主进程验证。
- three.js 0.180.0 / esbuild 0.25.10，官方 npm 包，下载 SHA-512 与 npm 元数据一致。
- 合成示例由 three.js GLTFExporter 生成，不应当当成 Rhino 导出成功证据。

## 已完成

- 插件 C# 零警告编译、内嵌正式网页模板、资源名与公开 API 反射检查。
- GLB 默认场景可达性和非空顶点校验：22 项用例分别通过 .NET Framework 4.8 和 .NET 10，包含真实合成示例、空场景、未引用网格、无效索引、节点环和损坏数据；此校验在写入 HTML 前执行。
- JSON 转义往返覆盖中文、HTML 脚本结束符、控制字符、emoji 和 Unicode 行分隔符。
- 网页浏览器检查：1280×800、390×844；模型显示、拖动旋转、滚轮缩放、复位、标准视图、自动旋转按钮状态、深浅背景。
- 内嵌 PNG 棋盘格纹理和透明蓝壳内橙球实际渲染成功。
- 截断 GLB、外部 image URI、坏 PNG 均出现相应中文错误。
- 只读逻辑检查：外部 image URI、外部 buffer URI、Draco 和截断 GLB 拒绝；190,001 字节 Base64 跨分块往返一致；大局部坐标网格 rebasing 在旋转与非均匀缩放后保持世界包围盒误差小于 1e-7。
- 包含所有 JS/CSS 和许可证，无外部脚本/样式依赖；加载器仅接受模型内的 data/blob 资源。

## 未完成及原因

- RhinoCore NoWindow 启动在初始化阶段返回 E_FAIL。
- 官方 Rhino 命令行另起独立隐藏测试进程，70 秒后仍未运行启动脚本，故停止了该独立进程；未操作已有 Rhino 进程。
- 因此尚未验证 Rhino 插件加载、实际 GLB 导出、材质转换、取消行为、交互选择恢复和覆盖输出路径行为。
- 浏览器工具安全策略禁止 file:// 导航。没有以其他途径绕过；离线文件直开兼容性尚未实际验证。HTTP 本地预览仅用于网页渲染检查。
- 全屏按钮未在内嵌浏览器确认进入全屏；保存截图与真实移动设备手势未实测。
- 大坐标精度测试只验证网页平移算法，不能恢复 Rhino float32 导出前已损失的数据。

## 后续本机验收步骤

1. 在 Rhino 8 加载 RHP；运行 RhinoWebExportDemo，确认 HTML 有三种实体和颜色。
2. 导出一个包含 JPG/PNG 贴图、透明物体、块实例和 SubD 的小模型。
3. 检查原文档对象数量、图层、几何和选择状态；分别测试完成、取消选择、取消保存与按 Esc。
4. 导出到已有 HTML 路径，验证成功替换及失败时原文件保留。
5. 用 Edge/Chrome 打开本地 HTML，断网重新打开；确认纹理、旋转、截图和全屏。
6. 使用手机浏览器打开托管后的页面，检查旋转、缩放、横竖屏与大文件内存。

## 重建

在源码目录使用较新的 Windows Node.js 执行：

```powershell
node bootstrap.mjs
node build.mjs
node create-demo.mjs
node qa/create-fixture.mjs
& .\plugin\Build.ps1 -ViewerTemplate .\dist\ViewerTemplate.html -OutputDirectory .\dist\plugin
```

bootstrap.mjs 固定依赖版本并检查 npm 的 SHA-512。仅构建需要联网，导出和展示不依赖网络。
