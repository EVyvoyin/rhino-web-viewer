$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$packageVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
# Keep older RHP paths available: Rhino may still have that assembly loaded and locked.
$artifactRoot = Join-Path $projectRoot ('artifacts\' + $packageVersion)
$packageStage = Join-Path $projectRoot '.build\installer'
New-Item -ItemType Directory -Path $artifactRoot, $packageStage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\plugin\RhinoWebViewer.rhp') -Destination $artifactRoot -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\demo.html') -Destination (Join-Path $artifactRoot 'demo.html') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\index.html') -Destination (Join-Path $artifactRoot 'viewer.html') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'launcher\open-viewer.cmd') -Destination (Join-Path $artifactRoot '打开模型查看器.cmd') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'launcher\使用方法.txt') -Destination (Join-Path $artifactRoot '使用方法.txt') -Force
# Stable entry for people opening the source template in Chrome or Edge.
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\index.html') -Destination (Join-Path $projectRoot 'artifacts\viewer.html') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\demo.html') -Destination (Join-Path $projectRoot 'artifacts\demo.html') -Force
Copy-Item -LiteralPath (Join-Path $artifactRoot 'RhinoWebViewer.rhp') -Destination $packageStage -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'licenses\three-MIT.txt') -Destination (Join-Path $packageStage 'THREE-LICENSE.txt') -Force
$installerZip = Join-Path $projectRoot '.build\RhinoWebViewer.zip'
Compress-Archive -LiteralPath (Join-Path $packageStage 'RhinoWebViewer.rhp'), (Join-Path $packageStage 'THREE-LICENSE.txt') -DestinationPath $installerZip -Force
Copy-Item -LiteralPath $installerZip -Destination (Join-Path $artifactRoot 'RhinoWebViewer.rhi') -Force
Get-ChildItem -LiteralPath $artifactRoot | Select-Object Name, Length
