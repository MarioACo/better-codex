# Changelog

## 0.1.0 — 2026-10-27

Primera versión.

- **Hooks**: resumen del repo al iniciar sesión, modos de prompt (`+`, `rapido:`, `pregunta:`, `plan:`) y guías por tipo de tarea, rutas sugeridas, dieta de tokens, aviso de salidas enormes, verify gate y medidor de contexto y límites.
- **Guard**: detiene borrados irrecuperables, descartar cambios sin commit, reescrituras de historial, secretos, bases de datos, infraestructura, cerrar programas por nombre, configuración global y cambios de sistema, también dentro de scripts, `package.json`, tuberías y bloques de PowerShell. La aprobación vale para esa acción y ese turno.
- **Skills** (plugin `bcx`): `$bcx:commit`, `$bcx:refine`, `$bcx:handoff`, `$bcx:debug`.
- **CLI**: `install` (copia estable en `~/.codex/better-codex/app`, con respaldos), `uninstall`, `doctor` (prueba los hooks en tus shells y muestra lo que Codex envía de verdad), `stats`, `usage`, `audit`, `log`, `brief`, `try`, `guard`, `config`.
