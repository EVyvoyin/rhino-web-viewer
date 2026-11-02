param(
    [Parameter(Mandatory = $true)][string]$ViewerTemplate,
    [string]$RhinoSystemDirectory = 'C:\Program Files\Rhino 8\System',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'build')
)
$ErrorActionPreference = 'Stop'
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$rhinoAssembly = Join-Path $RhinoSystemDirectory 'RhinoCommon.dll'
if (-not (Test-Path -LiteralPath $compilerPath)) { throw 'The Windows .NET Framework C# compiler was not found.' }
if (-not (Test-Path -LiteralPath $rhinoAssembly)) { throw 'Rhino 8 RhinoCommon.dll was not found.' }
$templatePath = (Resolve-Path -LiteralPath $ViewerTemplate).Path
$templateText = [System.IO.File]::ReadAllText($templatePath)
if ([regex]::Matches($templateText, '__RV_CONFIG_JSON__').Count -ne 1) {
    throw 'The viewer template must contain exactly one __RV_CONFIG_JSON__ marker.'
}
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$pluginPath = Join-Path $outputPath 'RhinoWebViewer.rhp'
$compileArguments = @(
    '/nologo', '/target:library', '/platform:anycpu', '/optimize+', '/codepage:65001',
    '/warn:4', '/warnaserror+', ('/out:' + $pluginPath),
    ('/reference:' + $rhinoAssembly), '/reference:System.dll', '/reference:System.Core.dll',
    '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
    '/reference:System.Runtime.Serialization.dll', '/reference:System.Xml.dll',
    ('/resource:' + $templatePath + ',RhinoWebViewer.ViewerTemplate.html'),
    (Join-Path $PSScriptRoot 'RhinoWebViewer.cs')
)
& $compilerPath $compileArguments
if ($LASTEXITCODE -ne 0) { throw "C# compilation failed with exit code $LASTEXITCODE." }
Get-Item -LiteralPath $pluginPath | Select-Object FullName, Length
Write-Output 'Plugin GUID: c0d86dc0-77e4-4c28-bc92-6b75e7898d53'
