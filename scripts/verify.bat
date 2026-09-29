@echo off
REM scripts\verify.bat
REM Lo mismo que correra la CI: lint, tests y build, en ese orden.
REM Se detiene en el primer paso que falle. No necesita el backend.
REM
REM Uso (desde la carpeta atencion-ia-frontend, en cmd.exe):
REM     scripts\verify.bat

echo === 1/3 lint (eslint + prettier) ===
call npm run lint || goto :fallo
echo === 2/3 tests ===
call npm test || goto :fallo
echo === 3/3 build ===
call npm run build || goto :fallo
echo.
echo Verificacion completa: todo en orden.
exit /b 0

:fallo
echo.
echo FALLO la verificacion (ver el paso de arriba).
exit /b 1
