# Rhino Web Viewer

将 Rhino 模型导出为一个可交互的 HTML 网页。顾客可在浏览器中旋转、缩放和查看模型，无需安装 Rhino，也不需要账号或订阅。

**当前版本：1.0.0-preview。** 网页查看器已完成渲染与交互检查；Rhino 内插件加载及真实模型端到端导出尚待实测，详细边界见 [验证记录](VALIDATION.md)。本仓库保存本次交付的完整源码和安装文件。

## 下载与使用

- [安装包 RhinoWebViewer.rhi](artifacts/RhinoWebViewer.rhi)
- [插件文件 RhinoWebViewer.rhp](artifacts/RhinoWebViewer.rhp)
- [演示模型网页](artifacts/demo.html)
- [独立 GLB 查看器](artifacts/viewer.html)

在 GitHub 文件页面点击 **Download raw file** 下载。HTML 文件需要先下载，再用浏览器打开；GitHub 源码页不会直接运行这个网页。

1. 使用 Windows Rhino 8，双击 `.rhi` 安装。若没有关联安装程序，可把 `.rhp` 拖入 Rhino 窗口；用这种方式时请保留插件文件所在位置。
2. 在 Rhino 中选中模型，输入命令 `RhinoWebExport` 并回车。
3. 保存 HTML。导出后浏览器会打开预览，把这一个 HTML 文件发送给顾客即可。

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

构建结果位于 `artifacts/`。运行模型校验：

```powershell
npm run test:glb
```

仓库结构：`viewer/` 为网页源代码，`plugin/` 为 Rhino 插件，`qa/` 为测试夹具和验证脚本，`artifacts/` 为本次交付文件。

## 组件许可

three.js 与 esbuild 的 MIT 许可证保存在 `licenses/`。three.js 许可同时嵌入导出的 HTML。项目原创代码尚未指定额外的开源许可证。
