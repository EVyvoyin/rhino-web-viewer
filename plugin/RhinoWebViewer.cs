using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using Rhino;
using Rhino.Commands;
using Rhino.DocObjects;
using Rhino.FileIO;
using Rhino.Geometry;
using Rhino.Input;
using Rhino.Input.Custom;
using Rhino.PlugIns;

[assembly: AssemblyTitle("Rhino Web Viewer")]
[assembly: AssemblyDescription("Export Rhino models as self-contained interactive HTML files.")]
[assembly: AssemblyCompany("Rhino Web Viewer")]
[assembly: AssemblyProduct("Rhino Web Viewer")]
[assembly: AssemblyVersion("1.0.3.0")]
[assembly: AssemblyFileVersion("1.0.3.0")]
[assembly: ComVisible(false)]
[assembly: Guid("c0d86dc0-77e4-4c28-bc92-6b75e7898d53")]

namespace RhinoWebViewer
{
    [Guid("c0d86dc0-77e4-4c28-bc92-6b75e7898d53")]
    public sealed class RhinoWebViewerPlugIn : PlugIn
    {
        public RhinoWebViewerPlugIn() { Instance = this; }
        public static RhinoWebViewerPlugIn Instance { get; private set; }
    }

    [Guid("e9783267-7d59-4ad9-a224-1477543bea6c")]
    public sealed class RhinoWebExportCommand : Command
    {
        public override string EnglishName { get { return "RhinoWebExport"; } }

        protected override Result RunCommand(RhinoDoc doc, RunMode mode)
        {
            if (doc == null) return Result.Failure;
            List<SelectionRecord> previous = Exporter.CaptureSelection(doc);
            try
            {
                List<RhinoObject> objects = new List<RhinoObject>();
                int unsupported = 0;
                foreach (SelectionRecord item in previous)
                {
                    RhinoObject obj = doc.Objects.FindId(item.Id);
                    if (obj != null && Exporter.IsSupported(obj)) objects.Add(obj);
                    else unsupported++;
                }
                if (objects.Count == 0 && previous.Count > 0)
                {
                    RhinoApp.WriteLine("所选内容没有可导出的立体模型。请选择曲面、多重曲面、网格、SubD 或块实例。");
                    return Result.Nothing;
                }
                if (objects.Count == 0)
                {
                    using (GetObject pick = new GetObject())
                    {
                        pick.SetCommandPrompt("选择要分享的模型；直接按 Enter 导出全部可见且可选模型");
                        pick.GeometryFilter = Exporter.SupportedTypes;
                        pick.SubObjectSelect = false;
                        pick.GroupSelect = true;
                        pick.AcceptNothing(true);
                        GetResult input = pick.GetMultiple(1, 0);
                        if (input == GetResult.Cancel) return Result.Cancel;
                        if (input == GetResult.Nothing)
                        {
                            int locked;
                            objects = Exporter.VisibleObjects(doc, out locked);
                            if (locked > 0)
                                RhinoApp.WriteLine("有 {0} 个锁定或不可选择的可见对象未导出；如需包含它们，请先解锁。", locked);
                        }
                        else if (input == GetResult.Object)
                        {
                            HashSet<Guid> unique = new HashSet<Guid>();
                            for (int i = 0; i < pick.ObjectCount; i++)
                            {
                                RhinoObject obj = pick.Object(i).Object();
                                if (obj != null && unique.Add(obj.Id)) objects.Add(obj);
                            }
                        }
                        else return pick.CommandResult();
                    }
                }
                if (objects.Count == 0)
                {
                    RhinoApp.WriteLine("没有可导出的模型。请确认模型可见、已解锁，并包含曲面或网格。");
                    return Result.Nothing;
                }
                if (unsupported > 0)
                    RhinoApp.WriteLine("已跳过 {0} 个不支持的选择项（例如曲线、标注或灯光）。", unsupported);
                foreach (SelectionRecord item in previous)
                    if (item.Components.Length > 0)
                    {
                        RhinoApp.WriteLine("检测到子对象选择，将导出它所属的完整对象。");
                        break;
                    }

                string output;
                Result pathResult = Exporter.GetOutputPath(doc, mode, false, out output);
                if (pathResult != Result.Success) return pathResult;
                Exporter.ClearSelection(doc);
                int selected = 0;
                foreach (RhinoObject obj in objects)
                    if (obj.Select(true, true, false, true, false, false) != 0) selected++;
                if (selected != objects.Count)
                    throw new InvalidOperationException("部分对象无法选择。请先解锁并关闭控制点，再重试导出。");
                RhinoApp.WriteLine("正在准备 {0} 个模型对象，请稍候……", selected);
                Exporter.ExportHtml(doc, output, true);
                Exporter.ReportSuccess(output, mode);
                return Result.Success;
            }
            catch (OperationCanceledException) { return Result.Cancel; }
            catch (Exception ex)
            {
                RhinoApp.WriteLine("网页导出失败：{0}", ex.Message);
                return Result.Failure;
            }
            finally
            {
                Exporter.RestoreSelection(doc, previous);
                doc.Views.Redraw();
            }
        }
    }

    [Guid("2abe876e-481e-4f64-ad53-11d9b8154364")]
    public sealed class RhinoWebExportDemoCommand : Command
    {
        public override string EnglishName { get { return "RhinoWebExportDemo"; } }

        protected override Result RunCommand(RhinoDoc doc, RunMode mode)
        {
            try
            {
                string output;
                Result pathResult = Exporter.GetOutputPath(doc, mode, true, out output);
                if (pathResult != Result.Success) return pathResult;
                Exporter.ExportDemoHtml(output);
                Exporter.ReportSuccess(output, mode);
                return Result.Success;
            }
            catch (OperationCanceledException) { return Result.Cancel; }
            catch (Exception ex)
            {
                RhinoApp.WriteLine("演示导出失败：{0}", ex.Message);
                return Result.Failure;
            }
        }
    }

    internal sealed class SelectionRecord
    {
        internal Guid Id;
        internal int State;
        internal ComponentIndex[] Components;
    }

    // The typed manifest ignores materials and binary data while still parsing real JSON.
    // DataContractJsonSerializer is available in both .NET Framework and modern .NET.
    [DataContract]
    internal sealed class GltfManifest
    {
        [DataMember(Name = "scene")] internal int? DefaultScene { get; set; }
        [DataMember(Name = "scenes")] internal GltfScene[] Scenes { get; set; }
        [DataMember(Name = "nodes")] internal GltfNode[] Nodes { get; set; }
        [DataMember(Name = "meshes")] internal GltfMesh[] Meshes { get; set; }
        [DataMember(Name = "accessors")] internal GltfAccessor[] Accessors { get; set; }
    }
    [DataContract]
    internal sealed class GltfScene
    {
        [DataMember(Name = "nodes")] internal int[] Nodes { get; set; }
    }
    [DataContract]
    internal sealed class GltfNode
    {
        [DataMember(Name = "mesh")] internal int? Mesh { get; set; }
        [DataMember(Name = "children")] internal int[] Children { get; set; }
    }
    [DataContract]
    internal sealed class GltfMesh
    {
        [DataMember(Name = "primitives")] internal GltfPrimitive[] Primitives { get; set; }
    }
    [DataContract]
    internal sealed class GltfPrimitive
    {
        [DataMember(Name = "attributes")] internal GltfAttributes Attributes { get; set; }
    }
    [DataContract]
    internal sealed class GltfAttributes
    {
        [DataMember(Name = "POSITION")] internal int? Position { get; set; }
    }
    [DataContract]
    internal sealed class GltfAccessor
    {
        [DataMember(Name = "count")] internal long Count { get; set; }
        [DataMember(Name = "type")] internal string Type { get; set; }
    }

    public static class Exporter
    {
        internal const ObjectType SupportedTypes = ObjectType.Brep | ObjectType.Surface |
            ObjectType.Mesh | ObjectType.Extrusion | ObjectType.SubD | ObjectType.InstanceReference;
        private const string ConfigMarker = "__RV_CONFIG_JSON__";
        private const string TemplateResource = "RhinoWebViewer.ViewerTemplate.html";

        internal static bool IsSupported(RhinoObject obj)
        { return (obj.ObjectType & SupportedTypes) != ObjectType.None; }

        private static ObjectEnumeratorSettings AllObjectSettings()
        {
            return new ObjectEnumeratorSettings {
                NormalObjects = true, LockedObjects = true, HiddenObjects = true,
                ActiveObjects = true, ReferenceObjects = true, IncludeGrips = true,
                IncludeLights = true, IncludePhantoms = true
            };
        }

        internal static List<SelectionRecord> CaptureSelection(RhinoDoc doc)
        {
            List<SelectionRecord> selection = new List<SelectionRecord>();
            foreach (RhinoObject obj in doc.Objects.GetObjectList(AllObjectSettings()))
            {
                int state = obj.IsSelected(false);
                ComponentIndex[] components = obj.GetSelectedSubObjects() ?? new ComponentIndex[0];
                if (state != 0 || components.Length > 0)
                    selection.Add(new SelectionRecord { Id = obj.Id, State = state, Components = components });
            }
            return selection;
        }

        internal static void ClearSelection(RhinoDoc doc)
        {
            foreach (RhinoObject obj in doc.Objects.GetObjectList(AllObjectSettings()))
            {
                obj.UnselectAllSubObjects();
                if (obj.IsSelected(false) != 0) obj.Select(false);
            }
        }

        internal static void RestoreSelection(RhinoDoc doc, List<SelectionRecord> previous)
        {
            ClearSelection(doc);
            foreach (SelectionRecord item in previous)
            {
                RhinoObject obj = doc.Objects.FindId(item.Id);
                if (obj == null) continue;
                if (item.State != 0) obj.Select(true, true, item.State == 2, true, true, true);
                foreach (ComponentIndex component in item.Components) obj.SelectSubObject(component, true, true, true);
            }
        }

        internal static List<RhinoObject> VisibleObjects(RhinoDoc doc, out int skipped)
        {
            List<RhinoObject> objects = new List<RhinoObject>();
            skipped = 0;
            ObjectEnumeratorSettings settings = new ObjectEnumeratorSettings {
                NormalObjects = true, LockedObjects = true, HiddenObjects = false,
                ActiveObjects = true, ReferenceObjects = false,
                ObjectTypeFilter = SupportedTypes, VisibleFilter = true
            };
            foreach (RhinoObject obj in doc.Objects.GetObjectList(settings))
            {
                if (obj.IsSelectable(true, true, false, false)) objects.Add(obj);
                else skipped++;
            }
            return objects;
        }

        internal static Result GetOutputPath(RhinoDoc doc, RunMode mode, bool demo, out string output)
        {
            output = null;
            string stem = demo ? "Rhino模型演示" : (doc != null ? Path.GetFileNameWithoutExtension(doc.Name) : null);
            if (string.IsNullOrWhiteSpace(stem)) stem = "模型预览";
            string defaultFile = stem + "-360预览.html";
            if (mode == RunMode.Scripted)
            {
                string scriptedPath = "";
                Result result = RhinoGet.GetString("网页保存路径（.html）", false, ref scriptedPath);
                if (result != Result.Success) return result;
                if (string.IsNullOrWhiteSpace(scriptedPath)) return Result.Cancel;
                output = scriptedPath.Trim().Trim('"');
            }
            else
            {
                Rhino.UI.SaveFileDialog dialog = new Rhino.UI.SaveFileDialog();
                dialog.Title = "保存可旋转的模型网页";
                dialog.Filter = "独立模型网页 (*.html)|*.html";
                dialog.DefaultExt = "html";
                dialog.FileName = defaultFile;
                if (doc != null && !string.IsNullOrWhiteSpace(doc.Path))
                    dialog.InitialDirectory = Path.GetDirectoryName(doc.Path);
                if (!dialog.ShowSaveDialog()) return Result.Cancel;
                output = dialog.FileName;
            }
            if (!string.Equals(Path.GetExtension(output), ".html", StringComparison.OrdinalIgnoreCase))
                output += ".html";
            output = Path.GetFullPath(output);
            if (!Directory.Exists(Path.GetDirectoryName(output)))
                throw new DirectoryNotFoundException("所选保存文件夹不存在。");
            return Result.Success;
        }

        // Public entry points are also usable from Rhino's script editor for isolated smoke tests.
        public static void ExportDemoHtml(string outputPath)
        {
            using (RhinoDoc demo = RhinoDoc.CreateHeadless(null))
            {
                if (demo == null) throw new InvalidOperationException("无法创建独立演示文档。");
                demo.ModelUnitSystem = UnitSystem.Millimeters;
                ObjectAttributes body = new ObjectAttributes();
                body.Name = "展示台";
                body.ColorSource = ObjectColorSource.ColorFromObject;
                body.ObjectColor = Color.FromArgb(38, 50, 66);
                Box box = new Box(Plane.WorldXY, new Interval(-45, 45), new Interval(-35, 35), new Interval(-8, 0));
                using (Brep shape = box.ToBrep()) demo.Objects.AddBrep(shape, body);
                ObjectAttributes accent = body.Duplicate();
                accent.Name = "蓝色球体";
                accent.ObjectColor = Color.FromArgb(30, 143, 210);
                using (Brep sphere = new Sphere(new Point3d(-17, 0, 19), 19).ToBrep()) demo.Objects.AddBrep(sphere, accent);
                accent = body.Duplicate();
                accent.Name = "铜色圆环";
                accent.ObjectColor = Color.FromArgb(218, 150, 72);
                Plane ringPlane = new Plane(new Point3d(23, 0, 17), Vector3d.YAxis);
                using (Brep ring = new Torus(ringPlane, 13, 4).ToBrep()) demo.Objects.AddBrep(ring, accent);
                ExportHtml(demo, outputPath, false);
            }
        }

        public static void ExportHtml(RhinoDoc doc, string outputPath, bool selectedOnly)
        {
            if (doc == null) throw new ArgumentNullException("doc");
            outputPath = Path.GetFullPath(outputPath);
            if (!Directory.Exists(Path.GetDirectoryName(outputPath)))
                throw new DirectoryNotFoundException("所选保存文件夹不存在。");
            string tempDirectory = Path.Combine(Path.GetTempPath(), "RhinoWebViewer-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempDirectory);
            string glbPath = Path.Combine(tempDirectory, "model.glb");
            string pendingHtml = Path.Combine(Path.GetDirectoryName(outputPath), ".rhino-web-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                FileGltfWriteOptions options = new FileGltfWriteOptions {
                    MapZToY = true, ExportMaterials = true, CullBackfaces = false,
                    UseDisplayColorForUnsetMaterials = true, ExportTextureCoordinates = true,
                    ExportVertexNormals = true, ExportOpenMeshes = true, ExportVertexColors = true,
                    UseDracoCompression = false, ExportLayers = true,
                    SubDMeshType = FileGltfWriteOptions.SubDMeshing.Surface, SubDSurfaceMeshingDensity = 3
                };
                bool cancelled = false;
                bool written;
                EventHandler cancelHandler = delegate { cancelled = true; };
                RhinoApp.EscapeKeyPressed += cancelHandler;
                try
                {
                    written = selectedOnly ? doc.ExportSelected(glbPath, options.ToDictionary()) :
                        doc.Export(glbPath, options.ToDictionary());
                }
                finally { RhinoApp.EscapeKeyPressed -= cancelHandler; }
                if (cancelled) throw new OperationCanceledException();
                if (!written || !File.Exists(glbPath))
                    throw new InvalidOperationException("Rhino 未完成 GLB 导出。请确认已安装 Rhino 8.3 或更新版本，并检查模型内容。");
                byte[] glb = File.ReadAllBytes(glbPath);
                ValidateGlb(glb);
                if (glb.Length > 50 * 1024 * 1024)
                    RhinoApp.WriteLine("提示：模型超过 50 MB，手机打开可能较慢。可减少对象或先简化网格。");
                string template;
                using (Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream(TemplateResource))
                {
                    if (source == null) throw new InvalidOperationException("插件缺少网页查看器资源，请重新安装完整插件。");
                    using (StreamReader reader = new StreamReader(source, Encoding.UTF8)) template = reader.ReadToEnd();
                }
                int marker = template.IndexOf(ConfigMarker, StringComparison.Ordinal);
                if (marker < 0 || template.IndexOf(ConfigMarker, marker + ConfigMarker.Length, StringComparison.Ordinal) >= 0)
                    throw new InvalidDataException("网页模板配置标记无效。");
                string title = Path.GetFileNameWithoutExtension(outputPath);
                string config = "{\"title\":" + JsonQuote(title) + ",\"fileName\":" + JsonQuote(title + ".glb") +
                    ",\"modelBase64\":" + JsonQuote(Convert.ToBase64String(glb)) + "}";
                using (StreamWriter writer = new StreamWriter(pendingHtml, false, new UTF8Encoding(false)))
                {
                    writer.Write(template.Substring(0, marker));
                    writer.Write(config);
                    writer.Write(template.Substring(marker + ConfigMarker.Length));
                }
                // Same-directory move/replace keeps any existing output intact until the new file is complete.
                if (File.Exists(outputPath)) File.Replace(pendingHtml, outputPath, null);
                else File.Move(pendingHtml, outputPath);
            }
            finally
            {
                try { if (File.Exists(pendingHtml)) File.Delete(pendingHtml); } catch { }
                try { if (Directory.Exists(tempDirectory)) Directory.Delete(tempDirectory, true); } catch { }
            }
        }

        internal static void ValidateGlb(byte[] glb)
        {
            if (glb == null || glb.Length < 20 || BitConverter.ToUInt32(glb, 0) != 0x46546c67 ||
                BitConverter.ToUInt32(glb, 4) != 2 || BitConverter.ToUInt32(glb, 8) != glb.Length ||
                BitConverter.ToUInt32(glb, 16) != 0x4e4f534a)
                throw new InvalidDataException("Rhino 生成的模型文件不完整，请重新尝试。");
            uint jsonLength = BitConverter.ToUInt32(glb, 12);
            if (jsonLength == 0 || jsonLength > glb.Length - 20 || jsonLength % 4 != 0)
                throw new InvalidDataException("模型文件的 JSON 数据块不完整。");
            GltfManifest manifest;
            try
            {
                DataContractJsonSerializer serializer = new DataContractJsonSerializer(typeof(GltfManifest),
                    new DataContractJsonSerializerSettings { MaxItemsInObjectGraph = 5000000 });
                using (MemoryStream stream = new MemoryStream(glb, 20, (int)jsonLength, false))
                    manifest = (GltfManifest)serializer.ReadObject(stream);
            }
            catch (Exception ex)
            {
                if (!(ex is SerializationException) && !(ex is System.Xml.XmlException) && !(ex is FormatException)) throw;
                throw new InvalidDataException("模型文件的场景信息无法解析。", ex);
            }
            if (manifest == null || manifest.Scenes == null || manifest.Scenes.Length == 0 || manifest.Nodes == null ||
                manifest.Meshes == null || manifest.Meshes.Length == 0 || manifest.Accessors == null)
                throw NoGeometryException();
            int sceneIndex = manifest.DefaultScene ?? 0;
            if (sceneIndex < 0 || sceneIndex >= manifest.Scenes.Length || manifest.Scenes[sceneIndex] == null)
                throw new InvalidDataException("模型文件的默认场景索引无效。");
            int[] rootNodes = manifest.Scenes[sceneIndex].Nodes;
            if (rootNodes == null || rootNodes.Length == 0) throw NoGeometryException();
            Stack<int> pending = new Stack<int>(rootNodes);
            HashSet<int> visited = new HashSet<int>();
            bool hasGeometry = false;
            while (pending.Count > 0)
            {
                int nodeIndex = pending.Pop();
                if (nodeIndex < 0 || nodeIndex >= manifest.Nodes.Length || manifest.Nodes[nodeIndex] == null)
                    throw new InvalidDataException("模型文件包含无效的场景节点。");
                if (!visited.Add(nodeIndex)) continue;
                GltfNode node = manifest.Nodes[nodeIndex];
                if (node.Children != null)
                    foreach (int child in node.Children) pending.Push(child);
                if (!node.Mesh.HasValue) continue;
                int meshIndex = node.Mesh.Value;
                if (meshIndex < 0 || meshIndex >= manifest.Meshes.Length || manifest.Meshes[meshIndex] == null)
                    throw new InvalidDataException("模型文件包含无效的网格索引。");
                GltfPrimitive[] primitives = manifest.Meshes[meshIndex].Primitives;
                if (primitives == null) continue;
                foreach (GltfPrimitive primitive in primitives)
                {
                    if (primitive == null || primitive.Attributes == null || !primitive.Attributes.Position.HasValue) continue;
                    int positionIndex = primitive.Attributes.Position.Value;
                    if (positionIndex < 0 || positionIndex >= manifest.Accessors.Length || manifest.Accessors[positionIndex] == null)
                        throw new InvalidDataException("模型文件包含无效的顶点数据索引。");
                    GltfAccessor positions = manifest.Accessors[positionIndex];
                    if (positions.Count > 0 && string.Equals(positions.Type, "VEC3", StringComparison.Ordinal))
                        hasGeometry = true;
                }
            }
            if (!hasGeometry) throw NoGeometryException();
        }

        private static InvalidDataException NoGeometryException()
        {
            return new InvalidDataException("导出结果没有可显示的曲面或网格。请检查所选对象；仅包含曲线、点或标注的块无法展示。");
        }

        internal static string JsonQuote(string value)
        {
            if (value == null) return "null";
            StringBuilder json = new StringBuilder(value.Length + 2);
            json.Append('"');
            foreach (char ch in value)
            {
                switch (ch)
                {
                    case '"': json.Append("\\\""); break;
                    case '\\': json.Append("\\\\"); break;
                    case '\b': json.Append("\\b"); break;
                    case '\f': json.Append("\\f"); break;
                    case '\n': json.Append("\\n"); break;
                    case '\r': json.Append("\\r"); break;
                    case '\t': json.Append("\\t"); break;
                    default:
                        if (ch < 0x20 || ch == '<' || ch == '>' || ch == '&' || ch == '\u2028' || ch == '\u2029' || char.IsSurrogate(ch))
                            json.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                        else json.Append(ch);
                        break;
                }
            }
            return json.Append('"').ToString();
        }

        internal static void ReportSuccess(string path, RunMode mode)
        {
            RhinoApp.WriteLine("网页已保存：{0}", path);
            RhinoApp.WriteLine("把这一个 HTML 文件发给顾客，用浏览器打开即可旋转和缩放，无需 Rhino 或账号。");
            if (mode == RunMode.Interactive)
            {
                try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
                catch { RhinoApp.WriteLine("请在文件夹中双击生成的 HTML 文件预览。"); }
            }
        }
    }
}
