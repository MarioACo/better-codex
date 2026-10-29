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
- **Benchmark** (`bench/`): las mismas cuatro tareas con Codex solo y con better-codex, en copias nuevas de un repo pequeño, calificadas con comprobaciones que Codex nunca ve. Los resultados están en el README; córrelo tú con `node bench/run.mjs`.
- **doctor le pregunta al propio Codex** (`hooks/list` del app server, la misma lista que muestra `/hooks`) si los cinco hooks están cargados y aprobados, y señala los que cambiaron desde que los aprobaste. También avisa cuando tu Codex es más nuevo que la última versión probada (`codexTested` en package.json), cuando Codex deja de mandar un campo que leen los hooks (un cambio en su formato) y cuando un `AGENTS.override.md` oculta las reglas.
- **Codex real en la CI** (`scripts/codex-compat.mjs`): en Linux, macOS y Windows, con el Codex probado y con el más reciente, cada semana y con cada cambio. Sin login ni llamadas al modelo: comprueba que Codex carga las reglas, los skills y los cinco hooks, y corre cada hook en las terminales de ese sistema. Si un Codex nuevo lo rompe, la corrida semanal abre un issue.
- **Guard: `tmp/`, `build/` y `dist/` se revisan, no se confía en el nombre.** Siempre se podían borrar, así que el hook dejaba pasar `rm -rf tmp` aunque dentro hubiera notas sin commit (lo encontramos revisando el benchmark: ahí fueron las reglas las que hicieron preguntar a Codex, el hook nunca se activó). Ahora se borran solo si git no muestra nada tuyo dentro; `node_modules`, cachés y logs siguen sin preguntar.
- **Guard: tus alias y funciones.** Si tu perfil de PowerShell, `.bashrc` o `.zshrc` (o un archivo que cargan) dice que `nuke` es `rm -rf`, `nuke tmp` ahora se revisa como `rm -rf tmp`, y el mensaje nombra el alias. Codex corre PowerShell con tu perfil cargado, así que antes pasaban sin revisar (lo señalaron en Reddit). Los perfiles se leen como texto; `bcx doctor` muestra lo que encontró.
- **Benchmark**: `asked` también cuenta «Confirm that I should run…» y «Reply **approve**…», no solo respuestas con signo de interrogación. Recalculado en la corrida publicada: Codex preguntó 3/3 veces en la tarea de limpieza, no 1/3.
- **Formularios de issues** en inglés y español (bug, error del guard, idea) que piden la salida de `bcx doctor`, y una lista de revisión para PRs.
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
