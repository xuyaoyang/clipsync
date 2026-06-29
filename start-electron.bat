@echo off
set ELECTRON_RUN_AS_NODE=
set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"
cd /d "%APP_DIR%"
start "" "%APP_DIR%\node_modules\electron\dist\electron.exe" "%APP_DIR%"
