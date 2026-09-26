@echo off
setlocal
title Rift Coach
cd /d "%~dp0"

rem  Double-click this file to start the coach.
rem  It checks for Node.js, installs it if it is missing, starts the
rem  coach, and opens it in your browser. Nothing else is changed.

where node >nul 2>nul
if not errorlevel 1 goto run

echo.
echo   Rift Coach needs a free program called Node.js to run,
echo   and it is not on this computer yet.
echo.
where winget >nul 2>nul
if errorlevel 1 goto manual

echo   Installing it now. This takes a minute or two.
echo   If Windows asks for permission, click Yes.
echo.
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
set "PATH=%PATH%;%ProgramFiles%\nodejs"
where node >nul 2>nul
if not errorlevel 1 goto run

echo.
echo   Node.js is installed, but this window opened before it was.
echo   Close this window and double-click Start Coach again.
echo.
pause
exit /b 1

:manual
echo   Opening the Node.js download page for you.
echo   Click the big green download button, install it with the
echo   default options, then double-click Start Coach again.
start "" https://nodejs.org/
echo.
pause
exit /b 1

:run
echo.
echo   Starting Rift Coach. Your browser will open by itself.
echo.
echo   KEEP THIS WINDOW OPEN while you play.
echo   Closing it turns the coach off.
echo.
node server.mjs --open %*
echo.
echo   The coach has stopped.
pause
