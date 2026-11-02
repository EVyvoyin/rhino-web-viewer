$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$artifactRoot = Join-Path $projectRoot 'artifacts'
$packageStage = Join-Path $projectRoot '.build\installer'
New-Item -ItemType Directory -Path $artifactRoot, $packageStage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\plugin\RhinoWebViewer.rhp') -Destination $artifactRoot -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\demo.html') -Destination (Join-Path $artifactRoot 'demo.html') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\index.html') -Destination (Join-Path $artifactRoot 'viewer.html') -Force
Copy-Item -LiteralPath (Join-Path $artifactRoot 'RhinoWebViewer.rhp') -Destination $packageStage -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'licenses\three-MIT.txt') -Destination (Join-Path $packageStage 'THREE-LICENSE.txt') -Force
$installerZip = Join-Path $projectRoot '.build\RhinoWebViewer.zip'
Compress-Archive -LiteralPath (Join-Path $packageStage 'RhinoWebViewer.rhp'), (Join-Path $packageStage 'THREE-LICENSE.txt') -DestinationPath $installerZip -Force
Copy-Item -LiteralPath $installerZip -Destination (Join-Path $artifactRoot 'RhinoWebViewer.rhi') -Force
Get-ChildItem -LiteralPath $artifactRoot | Select-Object Name, Length
