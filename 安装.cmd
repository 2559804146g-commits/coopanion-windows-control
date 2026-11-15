@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Please install Node.js 22 or newer from nodejs.org first.
 pause
 exit /b 1
)
set /p "COMPANION_FOLDER=Coopanion 0.2.19 folder: "
call npm ci
if errorlevel 1 exit /b 1
call npm --prefix control-ui ci
if errorlevel 1 exit /b 1
call npm run build:voice
if errorlevel 1 exit /b 1
node scripts/setup.mjs --companion "%COMPANION_FOLDER%"
pause
