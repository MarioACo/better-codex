# Changelog

## Sin publicar

Encontrado probando con Codex 0.164 de verdad (extensión de VS Code, Windows):

- **Guard**: un «sí» a la pregunta que Codex hizo por su cuenta ya no exige una segunda confirmación. Cubre solo el comando o las rutas que esa pregunta mostraba. Codex ahora muestra el comando con rutas literales al preguntar.
- **Verify gate**: `npm.cmd test`, `node.exe --test` y similares cuentan como verificación (antes Codex repetía los tests).
- **Resumen del repo**: en Windows avisa de usar `npm.cmd` (PowerShell suele bloquear `npm.ps1`) y, si `rg` no está instalado, de buscar con `git grep -n`. Eran 2 llamadas fallidas por sesión.
- **Instalación**: imprime el comando exacto para abrir Codex y aprobar los hooks (`--no-daemon` con el CLI que trae la app); `[hooks.state]` en `config.toml` ya no se confunde con hooks duplicados.
- **doctor / log**: dicen qué falta de verdad y distinguen «permitido» de «ejecutado».

## 0.1.0 — 2026-10-27

Primera versión.

- **Hooks**: resumen del repo al iniciar sesión, modos de prompt (`+`, `rapido:`, `pregunta:`, `plan:`) y guías por tipo de tarea, rutas sugeridas, dieta de tokens, aviso de salidas enormes, verify gate y medidor de contexto y límites.
- **Guard**: detiene borrados irrecuperables, descartar cambios sin commit, reescrituras de historial, secretos, bases de datos, infraestructura, cerrar programas por nombre, configuración global y cambios de sistema, también dentro de scripts, `package.json`, tuberías y bloques de PowerShell. La aprobación vale para esa acción y ese turno.
- **Skills** (plugin `bcx`): `$bcx:commit`, `$bcx:refine`, `$bcx:handoff`, `$bcx:debug`.
- **CLI**: `install` (copia estable en `~/.codex/better-codex/app`, con respaldos), `uninstall`, `doctor` (prueba los hooks en tus shells y muestra lo que Codex envía de verdad), `stats`, `usage`, `audit`, `log`, `brief`, `try`, `guard`, `config`.
