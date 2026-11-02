# Rhino Web Viewer 插件源码

面向 Windows Rhino 8.3+，本机编译验证使用 Rhino 8.19 的 `RhinoCommon.dll`。编译为 C# 5 / .NET Framework 程序集，不带第三方 .NET 依赖。HTML 查看器以资源嵌入插件。

插件 GUID：`c0d86dc0-77e4-4c28-bc92-6b75e7898d53`

## 构建

在 PowerShell 中执行：

```powershell
& .\Build.ps1 -ViewerTemplate 'C:\path\to\ViewerTemplate.html' -OutputDirectory 'C:\path\to\output'
```

生成 `RhinoWebViewer.rhp`。请先在项目根目录运行 `npm run build`，再将生成的 `dist/ViewerTemplate.html` 作为正式模板。模板必须包含且仅包含一个 `__RV_CONFIG_JSON__`，它将替换为 JSON 对象，包含 `title`、`fileName` 和 `modelBase64`。嵌入资源名固定为 `RhinoWebViewer.ViewerTemplate.html`。

## 命令

- `RhinoWebExport`：优先导出预选对象；没有预选时允许交互选择，直接 Enter 导出全部可见且可选模型。保存后自动打开浏览器。
- `RhinoWebExportDemo`：创建临时、无界面的独立文档，生成示例模型并导出，不在用户文档中添加对象。
- 脚本模式可输入 `_-RhinoWebExportDemo "C:\path\demo.html"`，会读取路径，不显示保存对话框。

也可在 Rhino 的 C# / Python 脚本中加载插件程序集并调用 `RhinoWebViewer.Exporter.ExportDemoHtml(path)`。`Exporter.ExportHtml(doc, path, selectedOnly)` 可用于测试；此底层方法不改变选择，`selectedOnly = true` 读取已有选择。脚本调用必须在已初始化 Rhino 运行时的主线程上执行。

## 数据与限制

- 不修改原模型几何、属性或图层。交互命令在 `finally` 中恢复原有整体和子对象选择；选择子对象时导出所属完整对象并提示。
- 导出曲面、多重曲面、网格、挤出、SubD、块实例；独立曲线、标注、点、灯光不在第一版展示范围。对象自身或图层被锁定、导致无法选择时，会跳过并提示。
- 使用 Rhino 原生 glTF 导出器保留其支持的材质、贴图及显示色；禁用 Draco，方便离线查看。复杂程序材质的效果以 Rhino 导出器支持程度为准。
- 临时 GLB 使用独立随机目录，成功、异常时均尝试清理。输出先写同目录临时文件，再以 `File.Replace` / `File.Move` 原子提交；失败不覆盖原 HTML。
- 校验 GLB 头和 JSON 数据块，并使用运行时自带的 `DataContractJsonSerializer` 解析场景。只有默认场景的可达节点引用了有效网格，且至少一个 primitive 包含 `VEC3`、顶点数量大于零的 `POSITION` accessor，才打包 HTML；空结果不会覆盖原文件。此处不是完整 glTF 合规验证，不检查所有二进制 bufferView、材质或扩展。
- 配置 JSON 转义 `<`、`>`、`&`、控制字符、Unicode 分隔符及代理对，避免名称进入 HTML 脚本上下文。
- 没有网络上传、账号或订阅逻辑。浏览器收到 HTML 即获得模型数据，这不是防复制工具。

## 验证范围

编译与运行验证需要分开记录。C# 编译成功只确认本机 RhinoCommon API、资源打包及语法匹配；不代表已经在 Rhino 内完成实际导出。场景校验已在 .NET Framework 4.8 与 .NET 10 各通过 22 项验证，包含真实演示 GLB、默认场景、子节点、空网格、不可达网格、非法索引、零顶点、错误类型和损坏 JSON；运行时自带的序列化器不依赖 `System.Web.Extensions` 或第三方包。

本环境尝试独立 RhinoCore 和隐藏 Rhino CLI 进程时均未完成初始化，未取得真实 Rhino 导出成功证据；未操作用户已有 Rhino 进程。运行时验证请执行 `RhinoWebExportDemo`，然后至少检查含预选、取消选择、取消保存、覆盖已有文件及含贴图模型的导出。
