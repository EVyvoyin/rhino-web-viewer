param([string]$PluginPath = (Join-Path $PSScriptRoot '..\dist\plugin\RhinoWebViewer.rhp'))
$ErrorActionPreference = 'Stop'
[System.Reflection.Assembly]::LoadFrom('C:\Program Files\Rhino 8\System\RhinoCommon.dll') | Out-Null
$pluginAssembly = [System.Reflection.Assembly]::LoadFrom((Resolve-Path -LiteralPath $PluginPath).Path)
$method = $pluginAssembly.GetType('RhinoWebViewer.Exporter').GetMethod('ValidateGlb', [System.Reflection.BindingFlags]'Static,NonPublic')
function New-TestGlb([string]$Json) {
    $jsonBytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
    $chunkLength = [int]([Math]::Ceiling($jsonBytes.Length / 4.0) * 4)
    $data = New-Object byte[] (20 + $chunkLength)
    [Array]::Copy([BitConverter]::GetBytes([uint32]0x46546c67), 0, $data, 0, 4)
    [Array]::Copy([BitConverter]::GetBytes([uint32]2), 0, $data, 4, 4)
    [Array]::Copy([BitConverter]::GetBytes([uint32]$data.Length), 0, $data, 8, 4)
    [Array]::Copy([BitConverter]::GetBytes([uint32]$chunkLength), 0, $data, 12, 4)
    [Array]::Copy([BitConverter]::GetBytes([uint32]0x4e4f534a), 0, $data, 16, 4)
    [Array]::Copy($jsonBytes, 0, $data, 20, $jsonBytes.Length)
    for ($i = 20 + $jsonBytes.Length; $i -lt $data.Length; $i++) { $data[$i] = 32 }
    return ,$data
}
$baseJson = '{"asset":{"version":"2.0"},"scene":0,"scenes":[{"nodes":[0]}],"nodes":[{"mesh":0}],"meshes":[{"primitives":[{"attributes":{"POSITION":0}}]}],"accessors":[{"count":3,"type":"VEC3"}]}'
$testCases = @(
    @{ Name='reachable_mesh'; Valid=$true; Json=$baseJson },
    @{ Name='scene_zero_default'; Valid=$true; Json=$baseJson.Replace('"scene":0,','') },
    @{ Name='child_mesh'; Valid=$true; Json=$baseJson.Replace('"nodes":[{"mesh":0}]','"nodes":[{"children":[1]},{"mesh":0}]') },
    @{ Name='explicit_second_scene'; Valid=$true; Json=$baseJson.Replace('"scene":0','"scene":1').Replace('"scenes":[{"nodes":[0]}]','"scenes":[{"nodes":[]},{"nodes":[0]}]') },
    @{ Name='empty_meshes'; Valid=$false; Json=$baseJson.Replace('"meshes":[{"primitives":[{"attributes":{"POSITION":0}}]}]','"meshes":[]') },
    @{ Name='empty_primitives'; Valid=$false; Json=$baseJson.Replace('"primitives":[{"attributes":{"POSITION":0}}]','"primitives":[]') },
    @{ Name='empty_scene'; Valid=$false; Json=$baseJson.Replace('"scenes":[{"nodes":[0]}]','"scenes":[{"nodes":[]}]') },
    @{ Name='unreachable_mesh'; Valid=$false; Json=$baseJson.Replace('"nodes":[{"mesh":0}]','"nodes":[{}, {"mesh":0}]') },
    @{ Name='mesh_only_in_other_scene'; Valid=$false; Json=$baseJson.Replace('"scenes":[{"nodes":[0]}]','"scenes":[{"nodes":[]},{"nodes":[0]}]') },
    @{ Name='no_position'; Valid=$false; Json=$baseJson.Replace('"POSITION":0','"NORMAL":0') },
    @{ Name='zero_vertices'; Valid=$false; Json=$baseJson.Replace('"count":3','"count":0') },
    @{ Name='negative_vertices'; Valid=$false; Json=$baseJson.Replace('"count":3','"count":-1') },
    @{ Name='wrong_position_shape'; Valid=$false; Json=$baseJson.Replace('"type":"VEC3"','"type":"VEC2"') },
    @{ Name='bad_accessor_index'; Valid=$false; Json=$baseJson.Replace('"POSITION":0','"POSITION":99') },
    @{ Name='bad_mesh_index'; Valid=$false; Json=$baseJson.Replace('"mesh":0','"mesh":99') },
    @{ Name='bad_node_index'; Valid=$false; Json=$baseJson.Replace('"scenes":[{"nodes":[0]}]','"scenes":[{"nodes":[99]}]') },
    @{ Name='bad_scene_index'; Valid=$false; Json=$baseJson.Replace('"scene":0','"scene":9') },
    @{ Name='cycle_without_geometry'; Valid=$false; Json=$baseJson.Replace('"nodes":[{"mesh":0}]','"nodes":[{"children":[0]}]') },
    @{ Name='malformed_json'; Valid=$false; Json='{"scene":oops' },
    @{ Name='mesh_text_in_name_is_not_geometry'; Valid=$false; Json='{"asset":{"version":"2.0"},"nodes":[{"name":"\"meshes\":[{\"primitives\":[{}]}]"}]}' }
)
$testResults = @()
foreach ($case in $testCases) {
    $valid = $true
    $failure = $null
    $invokeArguments = New-Object object[] 1
    $invokeArguments[0] = [byte[]](New-TestGlb $case.Json)
    try { $method.Invoke($null, $invokeArguments) | Out-Null }
    catch { $valid = $false; $failure = $_.Exception.InnerException.Message }
    if ($valid -ne $case.Valid) { throw ('Unexpected result: ' + $case.Name + ' expected=' + $case.Valid + ' actual=' + $valid + ' error=' + $failure) }
    $testResults += [pscustomobject]@{ Name=$case.Name; Passed=$true; Accepted=$valid }
}
$realDemo = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot '..\dist\demo.glb'))
$invokeArguments = New-Object object[] 1
$invokeArguments[0] = $realDemo
$method.Invoke($null, $invokeArguments) | Out-Null
$testResults += [pscustomobject]@{ Name='real_demo_glb'; Passed=$true; Accepted=$true }
$badHeader = $realDemo.Clone()
$badHeader[8] = $badHeader[8] -bxor 1
$headerRejected = $false
$invokeArguments[0] = $badHeader
try { $method.Invoke($null, $invokeArguments) | Out-Null } catch { $headerRejected = $true }
if (-not $headerRejected) { throw 'Invalid GLB length was accepted.' }
$testResults += [pscustomobject]@{ Name='invalid_glb_header'; Passed=$true; Accepted=$false }
$report = [pscustomobject]@{ Runtime=[System.Runtime.InteropServices.RuntimeInformation]::FrameworkDescription; Count=$testResults.Count; Results=$testResults }
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'glb-validation-results.json') -Encoding UTF8
$report | Select-Object Runtime,Count
