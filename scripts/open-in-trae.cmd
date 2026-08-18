@echo off
setlocal
node "%~dp0open-in-trae.mjs" %*
exit /b %ERRORLEVEL%
