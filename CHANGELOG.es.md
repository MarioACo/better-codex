# Registro de cambios

[English](CHANGELOG.md) · **Español**

## Sin publicar

Encontrado probando con Codex 0.164 de verdad (extensión de VS Code, Windows):

- **Guard**: un «sí» a la pregunta que Codex hizo por su cuenta ya no exige una segunda confirmación. Cubre solo el comando o las rutas que esa pregunta mostraba. Codex ahora escribe el comando con rutas literales al preguntar.
- **Verify gate**: `npm.cmd test`, `node.exe --test` y similares cuentan como verificación. Antes, Codex volvía a correr los tests.
- **Resumen del repo**: en Windows le dice a Codex que use `npm.cmd`, porque PowerShell suele bloquear `npm.ps1`. Si `rg` no está instalado, le dice que busque con `git grep -n`. Cada una de estas era una llamada fallida en cada sesión.
- **Instalación**: imprime el comando exacto para abrir Codex y aprobar los hooks (`--no-daemon` con el CLI que trae la app de escritorio). Ya no confunde `[hooks.state]` de `config.toml` con un segundo juego de hooks.
- **doctor / log**: dicen qué falta de verdad, y distinguen «permitido» de «ejecutado».
- **Documentación**: README, guía para contribuir, política de seguridad y registro de cambios en inglés y español. El README suma un ejemplo de una sesión real y una sección de problemas comunes.

## 0.1.0 — 2026-10-27

Primera versión.

- **Hooks**: resumen del repo al iniciar sesión, modos de prompt (`+`, `rapido:`, `pregunta:`, `plan:`) y guías por tipo de tarea, rutas sugeridas, dieta de tokens, aviso de salidas enormes, verify gate y medidor de contexto y límites.
- **Guard**: detiene estas acciones, también dentro de scripts, `package.json`, tuberías y bloques de PowerShell. Una aprobación cubre esa acción, en ese turno.
  - borrados irrecuperables;
  - descartar cambios sin commit;
  - reescrituras de historial;
  - secretos;
  - bases de datos;
  - infraestructura;
  - cerrar programas por nombre;
  - configuración global;
  - cambios de sistema.
- **Skills** (plugin `bcx`): `$bcx:commit`, `$bcx:refine`, `$bcx:handoff`, `$bcx:debug`.
- **CLI**:
  - `install` (copia estable en `~/.codex/better-codex/app`, con respaldos) y `uninstall`;
  - `doctor` (prueba los hooks en tus terminales y muestra lo que Codex envió de verdad);
  - `stats`, `usage`, `audit`, `log`, `brief`, `try`, `guard`, `config`.
