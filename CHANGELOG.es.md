# Registro de cambios

[English](CHANGELOG.md) · **Español**

## 0.3.0 — 2026-10-29

Más eficiente, más seguro, mejores respuestas:

- **Relevo** (eficiencia). Al pasar el 80% del contexto, better-codex anota en qué va el trabajo, sin el modelo: los pedidos, los archivos que cambiaron, la última verificación y la última respuesta de Codex. La siguiente sesión en ese repo lo recibe una vez en su brief. En las sesiones del autor, las pocas que pasaron del 70% de contexto se llevaron el 79% de toda la entrada.
- **Comandos corregidos antes de correr** (eficiencia). En Windows `npm`, `npx`, `pnpm` y `yarn` pasan a `.cmd`, porque PowerShell bloquea el `.ps1`. Esa llamada fallaba en cada sesión; verificado en vivo, Codex ahora corre `npm.cmd --version` y obtiene la versión. `npm install` corre con `--no-audit --no-fund`, y un programa que faltaba y se reemplazó por una variante conocida (`python` → `py`) se recuerda. Codex aplica el cambio solo con `allow`, y en Codex ese `allow` solo lleva la entrada nueva: sus aprobaciones y su sandbox se evalúan otra vez para el comando corregido.
- **Dónde está definido** (eficiencia). Las funciones y clases que nombra el prompt llegan con su definición (`calcularTotal → src/tax.js:12`), de un `git grep` (~50 ms).
- **Revisión del diff antes de terminar** (mejores respuestas). Sin el modelo: `debugger`, `pdb.set_trace()`, prints de depuración, `.only`/`.skip` en pruebas, marcadores de conflicto y TODOs nuevos que agregó el cambio regresan a Codex una vez.
- **Primero las pruebas de lo que cambió** (mejores respuestas, eficiencia). El verify gate pide las pruebas de los archivos cambiados (`src/cart.js` → `node --test test/cart.test.js`) antes de la suite completa.
- **Herramientas MCP en el guard** (seguridad). SQL destructivo por un servidor de base de datos, y herramientas que borran, hacen merge, push, publican, despliegan, cobran o mandan mensajes, preguntan antes. Leer pasa. **`hooks.json` cambia: aprueba los hooks otra vez en `/hooks`.**
- **`bcx undo` para más**: el valor anterior de una clave de `git config --global` o de una variable de usuario de Windows, `~/.npmrc` y las bases SQLite locales antes de un `DROP` o reset aprobado.
- **`bcx allow` sugerido** la tercera vez que apruebas la misma acción en un repo.

Infraestructura, bases de datos, DevOps y modo estricto:

- **Guard: secretos de infraestructura.** Leer el estado de Terraform (`terraform.tfstate` guarda contraseñas en texto plano), `.tfvars`, kubeconfig, `.pgpass` o el `config.json` de Docker ahora pregunta antes, igual que los comandos que imprimen valores secretos: `kubectl get secret -o yaml`, `terraform output -json`, `terraform state pull`, `aws secretsmanager get-secret-value`, `gcloud secrets versions access`, Vault, 1Password, Doppler, Heroku.
- **Guard: clústeres de producción.** `kubectl apply/patch/scale/rollout…` y `helm install/upgrade/rollback` dirigidos a producción (por `--context`, `--kube-context`, el namespace o el contexto actual de kubectl) son críticos. Un `--dry-run` y los demás contextos no preguntan. También preguntan `terraform state rm/mv/push`, `force-unlock`, `taint` y `docker push`.
- **Resumen del repo: infraestructura y bases de datos.** Nombra los Dockerfiles, los servicios de Compose (Postgres, Redis…), Terraform, Kubernetes, Helm, GitHub Actions, Prisma y la carpeta de migraciones de cada herramienta común, y las verificaciones que Codex puede correr con las herramientas instaladas en tu máquina.
- **Verify gate: verificaciones de infraestructura.** Un `.tf`, Dockerfile, archivo de Compose, chart de Helm, manifiesto de Kubernetes, workflow o schema de Prisma que cambió tiene que revisarse con su herramienta antes de que Codex termine (`terraform validate`, `docker build --check`, `docker compose config`, `helm lint`, `kubectl kustomize`, actionlint, `prisma validate`), solo si esa herramienta está instalada. El fallo se lee de su salida.
- **Guías por área**: bases de datos, infraestructura como código, contenedores y Kubernetes, CI/CD, seguridad e interfaz, según las palabras del prompt y los archivos que nombra, una vez por sesión.
- **Skills**: `$bcx:ci` arregla un pipeline que falla desde el log del paso que falló; `$bcx:migrate` cambia un schema con una migración nueva y reversible probada en local.
- **Imágenes**: las reglas le piden a Codex ver las imágenes con el detalle por defecto, una o dos a la vez. En los últimos 30 días del autor, las 60 salidas más grandes de herramientas fueron todas imágenes vistas con `detail: "original"`.
- **Benchmark**: dos tareas nuevas, una migración sobre una tabla con datos y un Dockerfile de producción.
- **Modo estricto** (`bcx config set strict on`, lo señalaron en Reddit: «la seguridad no debería ser solo heurística»). Solo pasan sin preguntar los comandos de solo lectura, las consultas de git y gh, las pruebas, los builds, los linters y las verificaciones de infraestructura conocidos; todo lo demás pregunta, también lo que la lista no reconoce. Los riesgos reales se siguen reportando primero. `bcx audit --strict` muestra qué preguntaría, agrupado por comando; `bcx allow "git commit"` deja pasar un tipo de comando en un repo. En los últimos 30 días del autor: preguntaría en el 24% de los comandos, contra el 2% sin él. Apagado por defecto, y Codex no lo puede apagar.

## 0.2.0 — 2026-10-29

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
- **Guard: comandos que esconden lo que corren.** `powershell -EncodedCommand`, `echo … | base64 -d | bash` y `exec(b64decode(…))` pasaban, aunque el base64 fuera `rm -rf src` (lo señalaron en Reddit). Ahora el base64 se decodifica y se revisa como cualquier otro comando. `eval "$CMD"`, `iex $script`, `sh -c "$(…)"` y otra salida enviada por tubería a una terminal preguntan antes, porque lo que corren solo se conoce al correr. `sh -c "$(curl …)"` cuenta como correr un script descargado. Las líneas de configuración como `eval "$(ssh-agent -s)"` no preguntan. Repasando los últimos 30 días del autor (1721 comandos), esto agregó una pregunta.
- **`bcx undo`**: antes de que corra una acción que aprobaste, una copia de lo que puede destruir. Para borrados y sobrescrituras son los archivos; para comandos de git son tus cambios sin commit, los archivos sin seguimiento y todas las ramas y el stash, guardados como un commit en `refs/bcx/undo/` sin tocar tu índice. `git clean -fdx` copia lo que `git clean -n` dice que quitaría, `.env` ignorado incluido. `bcx undo 1` lo regresa. Nunca reemplaza un archivo que ya existe otra vez salvo con `--overwrite`, y también guarda el estado de antes de deshacer. Codex menciona la copia al preguntar, y una línea la confirma. Límites: 100 MB por copia, las últimas 20 copias de 14 días. Medido en un repo real en OneDrive: 441 ms la foto de git, 32 ms copiar 26 archivos.
- **`bcx allow`**: lo que el guard pregunta una y otra vez pero en un repo siempre está bien (`bcx allow "rm -rf generated/"`). Una carpeta cubre lo que tiene dentro; otras acciones se permiten tal como están escritas. El mensaje de bloqueo sugiere el comando. Las reglas viven en `~/.codex/better-codex/allow.json`, fuera de todos los repos, así que un repo clonado o un pull request no puede darse permisos.
- **Guard: la configuración de better-codex.** Que Codex ejecute `bcx allow`, `bcx config set guard off` o `bcx uninstall`, o que escriba `allow.json`, `config.json` o `~/.codex/hooks.json`, ahora pregunta antes. Antes, Codex podía apagar el guard con un comando.
- **Guard: alias de oh-my-zsh y otros plugins.** En macOS y Linux, Codex guarda una copia de tu terminal ya cargada (`~/.codex/shell_snapshots/<sesión>.*.sh`, bash y zsh). El guard lee la de la sesión, así que `grhh`, `gpf` o `ggf` de oh-my-zsh se revisan por lo que corren. El formato se tomó del código fuente de Codex (`codex-rs/shell-command/src/shell_snapshot_capture.rs`). También lee bien nombres como `gc!` y valores con `'\''`.
- **npm**: `npx @marioaco/better-codex install`, sin clonar. Los hooks y skills corren desde la copia instalada, nunca desde el caché de npx. (`better-codex` en npm es el proyecto de otra persona.)
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
