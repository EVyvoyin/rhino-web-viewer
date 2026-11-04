# Rhino Web Viewer

将 Rhino 模型导出为一个可交互的 HTML 网页。顾客可在浏览器中旋转、缩放和查看模型，无需安装 Rhino，也不需要账号或订阅。

**当前版本：1.0.3-preview。** 修复大型模型保存时反复复制完整字符串导致的内存不足：按块写出 HTML，并在保存期间暂停三维重绘。支持系统保存窗口、分块下载以及分块重开，仍只需一个 HTML 文件。Rhino 内插件加载及真实模型端到端导出尚待实测，详细边界见 [验证记录](VALIDATION.md)。

## 下载与使用

- [安装包 RhinoWebViewer.rhi](artifacts/1.0.3-preview/RhinoWebViewer.rhi)
- [插件文件 RhinoWebViewer.rhp](artifacts/1.0.3-preview/RhinoWebViewer.rhp)
- [演示模型网页](artifacts/1.0.3-preview/demo.html)
- [独立 GLB 查看器](artifacts/1.0.3-preview/viewer.html)
- [Windows 启动入口](artifacts/1.0.3-preview/打开模型查看器.cmd)，与 `viewer.html` 放在同一文件夹
- [使用方法](artifacts/1.0.3-preview/使用方法.txt)

在 GitHub 文件页面点击 **Download raw file** 下载。HTML 文件需要先下载，再用浏览器打开；GitHub 源码页不会直接运行这个网页。

推荐在 Windows 文件资源管理器中双击“打开模型查看器.cmd”，它会在独立 Chrome（未安装时尝试 Edge）中打开旁边的 `viewer.html`。启动器只打开网页，不修改浏览器设置。也可右键 `viewer.html`，选择“打开方式 → Google Chrome / Microsoft Edge”。

`viewer/index.template.html` 是开发模板；误开时会显示引导，它不是交付的查看器。若应用内置预览页出现“Page crashed”，请从文件资源管理器使用上述启动入口。

1. 使用 Windows Rhino 8，双击 `.rhi` 安装。若没有关联安装程序，可把 `.rhp` 拖入 Rhino 窗口；用这种方式时请保留插件文件所在位置。
2. 在 Rhino 中选中模型，输入命令 `RhinoWebExport` 并回车。
3. 保存 HTML。导出后浏览器会打开预览，把这一个 HTML 文件发送给顾客即可。

如果在网页里点“打开模型”换了一个 GLB，请再点右上角的 **保存模型网页**（或 Ctrl+S / Command+S）。Chrome / Edge 若支持系统保存窗口，会先让你选择位置，再分块写入 `模型名-360预览.html`；其他浏览器使用分块下载。等待进度完成后，将这个新保存的文件发给顾客。文件包含当前模型和贴图，重新打开无需再次选择 GLB，也可以继续替换模型并保存。取消系统保存窗口不会自动触发下载。

大型模型保存时保留最后一帧，暂停三维重绘，并显示百分比。生成的 HTML 使用 base64 存储模型，体积通常比 GLB 大约三分之一。分块降低了保存峰值内存，但大型场景本身仍需要足够内存和显存。

旧版 1.0.0 网页的“打开模型”只更新临时预览，不会改写原文件。升级查看器后，重新选择自己的 GLB，再使用“保存模型网页”。截图按钮只生成图片。

也可先运行 `RhinoWebExportDemo`，在独立临时文档中生成测试模型。它不会向当前文件添加对象。仓库附送的桌子演示由 three.js 生成，不代表已通过 Rhino 导出验证。

## 功能

- 拖动旋转、滚轮缩放、右键平移、自动旋转。
- 立体、正面、侧面与顶部视角，复位、深浅背景、截图及全屏。
- 模型数据、查看器代码和样式都嵌入 HTML，无需 CDN。
- 支持内嵌 JPG/PNG 贴图、颜色和透明材质；可打开或拖入未压缩 GLB。
- 宽屏和窄屏布局，触摸手势支持取决于浏览器。

## 范围与限制

面向 Windows Rhino 8，本次使用 Rhino 8.19 API 编译。支持曲面、多重曲面、网格、挤出、SubD 和块实例；独立曲线、标注、点与灯光不在本版范围。子对象选择会导出所属完整对象。

没有预选时可交互选择，直接回车导出全部可见且可选的模型。隐藏或锁定对象不会自动包含。颜色和材质以 Rhino 原生 GLB 导出器的支持范围为准，复杂程序材质可能需要先烘焙。

导出不会上传模型，也不会自动生成公网链接。客户在电脑浏览器中打开下载的 HTML；如果要在微信或手机中点链接查看，需将 HTML 部署到静态网站空间。部分聊天应用的文件预览器不会运行 HTML。网页内包含模型网格数据，不是防复制格式。

Rhino 授权仍需有效。大模型可能占用较多内存；远离坐标原点的极小模型可能受网格精度影响。本机自动测试未能启动 Rhino 运行时，文件直开、截图、全屏和真实触摸设备仍需验收。

## 在 VS Code 中开发

打开 `RhinoWebViewer.code-workspace`。源码修改需要较新的 Windows Node.js；插件使用者不需要 Node.js。

```powershell
npm run setup
npm run build
npm run build:plugin
npm run preview
```

`setup` 从官方 npm 仓库下载固定版本依赖并校验 SHA-512。`build:plugin` 需要本机 Rhino 8 和 Windows .NET Framework C# 编译器。预览地址为 `http://127.0.0.1:43187/demo.html`。VS Code 的“运行任务”菜单包含同样的操作。

构建安装包：

```powershell
npm run package
```

构建结果位于 `artifacts/版本号/`，保留旧版插件文件以免覆盖 Rhino 正在加载的程序集。运行模型校验：

```powershell
npm run test:glb
npm run test:save
```

仓库结构：`viewer/` 为网页源代码，`plugin/` 为 Rhino 插件，`qa/` 为测试夹具和验证脚本，`artifacts/` 为本次交付文件。

## 组件许可

three.js 与 esbuild 的 MIT 许可证保存在 `licenses/`。three.js 许可同时嵌入导出的 HTML。项目原创代码尚未指定额外的开源许可证。
