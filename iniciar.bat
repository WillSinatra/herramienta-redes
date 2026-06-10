@echo off
title Herramienta de Redes
cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  Node.js no encontrado. Iniciando modo compatible con PowerShell...
    echo.
    powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0server.ps1"
    echo.
    pause
    exit /b 0
)

echo.
echo  Iniciando servidor de redes en http://localhost:8080/
echo.

node "%~dp0server.js"

echo.
pause
