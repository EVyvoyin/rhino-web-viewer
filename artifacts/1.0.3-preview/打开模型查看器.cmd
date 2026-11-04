@echo off
setlocal
rem Open the packaged viewer in a full browser, independently of the Codex preview pane.
if not exist "%~dp0viewer.html" (
  echo The viewer.html file is missing. Keep this launcher next to viewer.html.
  pause
  exit /b 1
)
set "RHINO_VIEWER_BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "RHINO_VIEWER_BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined RHINO_VIEWER_BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "RHINO_VIEWER_BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined RHINO_VIEWER_BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "RHINO_VIEWER_BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined RHINO_VIEWER_BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "RHINO_VIEWER_BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined RHINO_VIEWER_BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "RHINO_VIEWER_BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined RHINO_VIEWER_BROWSER if exist "%LocalAppData%\Microsoft\Edge\Application\msedge.exe" set "RHINO_VIEWER_BROWSER=%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
if not defined RHINO_VIEWER_BROWSER (
  echo Chrome or Edge was not found. Right-click viewer.html and choose your browser.
  pause
  exit /b 1
)
start "" "%RHINO_VIEWER_BROWSER%" --new-window "%~dp0viewer.html"
endlocal
