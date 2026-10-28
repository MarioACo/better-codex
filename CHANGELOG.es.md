# Registro de cambios

[English](CHANGELOG.md) · **Español**

## Sin publicar

Encontrado probando con Codex 0.164 de verdad (extensión de VS Code, Windows):

- **Guard**: un «sí» a la pregunta que Codex hizo por su cuenta ya no exige una segunda confirmación. Cubre solo el comando o las rutas que esa pregunta mostraba. Codex ahora escribe el comando con rutas literales al preguntar.
- **Verify gate**: `npm.cmd test`, `node.exe --test` y similares cuentan como verificación. Antes, Codex volvía a correr los tests.
- **Resumen del repo**: en Windows le dice a Codex que use `npm.cmd`, porque PowerShell suele bloquear `npm.ps1`. Si `rg` no está instalado, le dice que busque con `git grep -n`. Cada una de estas era una llamada fallida en cada sesión.
- **Instalación**: imprime el comando exacto para abrir Codex y aprobar los hooks (`--no-daemon` con el CLI que trae la app de escritorio). Ya no confunde `[hooks.state]` de `config.toml` con un segundo juego de hooks.
- **doctor / log**: dicen qué falta de verdad, y distinguen «permitido» de «ejecutado».
- **Instalación y doctor saben si ya aprobaste los hooks** (por los registros de aprobación de Codex en `config.toml`). `install` solo te pide aprobarlos otra vez si de verdad cambiaron, y `doctor` muestra `trusted 5/5`.
- **Comandos lentos**: better-codex mide cada comando. Si uno tardó más de 30 s, se lo señala a Codex una vez y lo recuerda por repo, y el resumen de la siguiente sesión lo lista, así Codex lo corre y lo espera dentro de una sola llamada. En vivo, con unos tests de 75 s: 5 peticiones → 2, tokens de entrada −60%. `bcx stats` muestra la parte de la entrada gastada en esperar (27% en las sesiones del autor).
- **Reglas para Codex**: juntar en una llamada las lecturas independientes, y correr y esperar los comandos largos dentro de un solo `exec` en vez de esperas separadas.
- **El verify gate revisa el resultado**: si la última verificación después de un cambio falló (node:test, Jest, Vitest, Mocha, pytest, Go, Cargo, tsc, ESLint, Gradle, Maven, .NET, Karma, Angular, npm) y la respuesta de Codex no lo dice, lo regresa una vez a arreglarla o a decirlo.
- **Hooks más rápidos**: el guard solo le pregunta a git la raíz del repo cuando una regla la necesita, y la sesión la recuerda: cerca de la mitad del tiempo propio de better-codex por comando.
- **Rutas en macOS y Windows**: el guard solo reconocía los cambios del propio Codex si la ruta venía escrita igual que la escribe git. En macOS (`/var` → `/private/var`) y con nombres cortos de Windows (`C:\Users\RUNNER~1`) preguntaba por ellos como si fueran del usuario. Ahora las rutas se comparan ya resueltas.
- **La instalación nunca deja hooks rotos**: comprueba que la copia de la app de verdad esté ahí y, si no, se detiene con un error claro. Antes seguía en silencio, y en la CI de Windows dejó hooks apuntando a un archivo inexistente con una carpeta de usuario con espacios y acentos.
- **Encuentra Codex dentro de las extensiones de editor**: `install` busca el CLI completo que trae la extensión de OpenAI para VS Code, VS Code Insiders, Cursor y Windsurf. Quien solo tiene la extensión ahora recibe los skills y un comando que funciona para abrir `/hooks` (sin `--no-daemon`). El README dice dónde funciona better-codex (CLI, extensión, app de escritorio, WSL) y dónde no (Codex Cloud).
- **Documentación**: README, guía para contribuir, política de seguridad y registro de cambios en inglés y español. El README suma una demo animada de una sesión real (`scripts/demo-svg.mjs`), una sección de problemas comunes y un consejo para apagar los skills de plugins que no usas.

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
