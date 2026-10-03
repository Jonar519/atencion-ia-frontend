@echo off
REM scripts\e2e.bat
REM E2E del flujo critico (Playwright) contra un entorno AISLADO, sin tocar la
REM base de desarrollo: base atencion_ia_e2e, Redis base 1, API en 4101,
REM worker con metricas en 9466 y el build del frontend servido en 4175.
REM IA y voz simuladas (mock).
REM
REM Requisitos: Docker con Postgres y Redis de atencion-ia-database levantados,
REM Google Chrome instalado (Playwright lo usa con un perfil temporal) y las
REM tres carpetas hermanas (atencion-ia-database, -backend, -frontend).
REM
REM Uso (desde la carpeta atencion-ia-frontend, en cmd.exe):
REM     scripts\e2e.bat
REM Abre tres ventanas minimizadas (API, worker, frontend) y las cierra al terminar.

setlocal
set ROOT=%~dp0..\..
set BACKEND=%ROOT%\atencion-ia-backend
set DATABASE=%ROOT%\atencion-ia-database

echo === 1/5 Base de pruebas atencion_ia_e2e ===
docker exec atencion_ia_postgres psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'atencion_ia_e2e'" | findstr 1 >nul
if errorlevel 1 docker exec atencion_ia_postgres createdb -U postgres atencion_ia_e2e || goto :fallo
pushd "%DATABASE%"
set DB_NAME=atencion_ia_e2e
call scripts\migrate.bat || (popd & goto :fallo)
call scripts\seed.bat || (popd & goto :fallo)
set DB_NAME=
popd

REM Variables del entorno aislado (secretos SOLO de prueba, no los de tu .env).
set JWT_SECRET=secreto-solo-para-e2e-0123456789-abcdefghij
set IP_HASH_SECRET=otro-secreto-solo-para-e2e-9876543210-xyz
set DATABASE_URL=postgresql://postgres:postgres@localhost:5434/atencion_ia_e2e
set REDIS_URL=redis://localhost:6380/1
set LOG_LEVEL=warn
set AI_PROVIDER=mock
set VOICE_PROVIDER=mock
set CORS_ORIGIN=http://localhost:4175
REM Adjuntos y fotos del E2E en su propia carpeta: sin esto iban a la de
REM desarrollo (..\atencion-ia-storage), mezclados con tus archivos.
set STORAGE_LOCAL_DIR=%TEMP%\atencion-ia-e2e-storage
REM Limites por IP x5: cada corrida completa ~6 invitaciones (10 por hora por IP) y la
REM base 1 de Redis conserva los contadores entre corridas locales seguidas. Ningun
REM escenario E2E prueba los limites (eso lo hacen los tests del backend).
set RATE_LIMIT_SCALE=5

echo === 2/5 Backend: compilar e indexar la base de conocimiento ===
pushd "%BACKEND%"
call npm run build || (popd & goto :fallo)
call npm run kb:reindex || (popd & goto :fallo)
REM Fase 7: el admin del seed vuelve a enrolarse en la verificacion en dos pasos en cada corrida.
call npm run staff:reset-mfa -- admin@cordillera.example || (popd & goto :fallo)
start "atencion-ia-e2e-api" /min cmd /c "set PORT=4101&& node dist\server.js"
start "atencion-ia-e2e-worker" /min cmd /c "set WORKER_METRICS_PORT=9466&& node dist\workers\worker.js"
popd

echo === 3/5 Frontend: build y vite preview en 4175 ===
call npm run build || goto :fallo
start "atencion-ia-e2e-frontend" /min cmd /c "set VITE_BACKEND_URL=http://localhost:4101&& npx vite preview --port 4175 --strictPort"

echo === 4/5 Esperando a que todo responda ===
set /a INTENTOS=0
:esperar
set /a INTENTOS+=1
if %INTENTOS% gtr 60 goto :fallo_arranque
REM Pausa de 1 s (ping funciona igual en cualquier consola, sin pedir teclado).
ping -n 2 127.0.0.1 >nul
curl -sf http://localhost:4101/ready >nul 2>&1 || goto :esperar
curl -sf http://localhost:4175/ >nul 2>&1 || goto :esperar

echo === 5/5 Playwright ===
call npx playwright test
set RESULTADO=%errorlevel%
call :cerrar
if not "%RESULTADO%"=="0" goto :fallo
echo.
echo E2E completo: todo en orden.
exit /b 0

:fallo_arranque
echo El entorno no respondio a tiempo. Revisa las ventanas minimizadas "atencion-ia-e2e-*".
call :cerrar
:fallo
echo.
echo FALLO el E2E (ver arriba).
exit /b 1

:cerrar
taskkill /FI "WINDOWTITLE eq atencion-ia-e2e-*" /T /F >nul 2>&1
REM npx deja a node como proceso aparte: se cierra también por puerto.
for %%P in (4101 9466 4175) do (
    for /f "tokens=5" %%I in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do taskkill /PID %%I /T /F >nul 2>&1
)
exit /b 0
