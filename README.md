# better-codex

Hooks, skills y métricas para [OpenAI Codex](https://developers.openai.com/codex) que hacen tres cosas:

1. **Gasta menos tokens**: Codex arranca sabiendo cómo es tu repo, no vuelca lockfiles ni `node_modules`, y te avisa antes de que una sesión se vuelva cara.
2. **Responde mejor**: cada prompt recibe la guía justa para su tipo de tarea, los archivos que mencionas se resuelven a rutas reales, y no termina sin verificar el código que cambió.
3. **Es más seguro**: antes de algo destructivo (borrar, descartar cambios, `push --force`, `DROP TABLE`, deploys, secretos), Codex se detiene, te explica qué quiere hacer, por qué, qué se puede perder y qué alternativa hay, y solo sigue si respondes «sí».

Todo corre en tu máquina, sin dependencias y sin enviar nada a ningún lado. Inspirado en [better-claude](https://github.com/midudev/better-claude).

## Por qué

Medido en 34 sesiones reales de Codex (`bcx stats`): **7 sesiones que pasaron del 70% de contexto se llevaron el 79% de todos los tokens de entrada**. Cada petición reenvía la conversación entera, así que una sesión larga cuesta cada vez más y responde peor.

Y en esas sesiones, de 3,331 llamadas a herramientas, el guard habría pedido confirmación en 34 (1%, `bcx audit`): 25 borrados, 6 cambios de configuración global, 2 cambios al historial de git (un `push --force-with-lease` a main y el borrado de un tag remoto) y 1 lectura de credenciales. Entre los cambios globales, Codex ejecutó `git config --global user.email …` y reemplazó, sin preguntar, la identidad de git que usaban todos los demás repos de la máquina. Pocas interrupciones, justo en las acciones que importan.

## Instalar

Requisitos: Node 20+ y Codex con hooks (CLI, extensión de VS Code o app de escritorio; `codex features list` debe mostrar `hooks … true`).

```bash
git clone https://github.com/MarioACo/better-codex
cd better-codex
node bin/bcx.js install --dry-run   # muestra qué cambiaría, sin escribir nada
node bin/bcx.js install
node bin/bcx.js doctor
```

`install` hace esto, con respaldo previo de cada archivo en `~/.codex/better-codex/backups/`:

- copia better-codex a `~/.codex/better-codex/app/`, de donde corren los hooks: puedes mover o borrar el clon, cambiar de versión de Node con nvm o instalar con `npx`, y sigue funcionando,
- agrega 5 hooks a `~/.codex/hooks.json` (los tuyos se quedan intactos),
- agrega un bloque delimitado de reglas al final de `~/.codex/AGENTS.md`,
- registra el marketplace e instala el plugin `bcx` (4 skills).

**Último paso, tuyo**: abre Codex en una terminal, escribe `/hooks` y aprueba los 5 de better-codex. Codex nunca ejecuta hooks que no aprobaste, y si cambian te los vuelve a pedir. Ojo: la app de escritorio y `codex exec` se los saltan sin avisar, así que este paso no es opcional. Después, `bcx doctor` muestra en "Lo que Codex ha enviado de verdad" que los hooks están vivos.

Si solo tienes la app de escritorio o la extensión de VS Code, el CLI viene incluido pero no arranca solo («this CLI has no complete local package»). Ábrelo así; `bcx install` te imprime este comando con tu ruta:

```powershell
& "$env:USERPROFILE\.codex\.sandbox-bin\codex.exe" --no-daemon   # Windows
~/.codex/.sandbox-bin/codex --no-daemon                          # macOS / Linux
```

Para actualizar: `git pull` y `node bin/bcx.js install` otra vez. Para usar `bcx` desde cualquier carpeta: `npm link` dentro del repo.

## Qué hace

| Momento | Función | Qué hace |
| --- | --- | --- |
| Al iniciar sesión | **brief** | Le da a Codex rama, cambios sin commit, stack, comandos de test/lint/build y estructura del repo en ~150-300 tokens, lo que normalmente gasta explorando. Vuelve a darlo tras `/compact`. |
| Cada prompt | **boost** | Modos por prefijo (abajo), una guía corta según la tarea (bug, feature, refactor, tests, review, rendimiento, docs, pregunta; en español e inglés, una sola vez por sesión) y las rutas reales de los archivos que nombras (`login`, `ReportTable`, `format.ts:12`). |
| Antes de cada comando | **guard** | Detiene acciones destructivas o difíciles de deshacer hasta que digas «sí». Ver [Seguridad](#seguridad). |
| Antes de cada comando | **diet** | Evita leer completos lockfiles grandes, salida de build, binarios y archivos de más de 200 KB, y listados recursivos que recorrerían `node_modules`. Le dice a Codex cómo hacerlo bien (`rg -n`, rangos de líneas). |
| Después de cada comando | **big output** | Si una salida fue enorme (más de 48 KB), le recuerda a Codex acotar las siguientes búsquedas. |
| Al terminar | **verify gate** | Si cambió código y no corrió ninguna verificación después del último cambio, lo manda una vez a ejecutar `npm test` (o lo que use tu proyecto) antes de responder. |
| Al terminar | **meter** | Te avisa debajo de la respuesta cuando el contexto pasa del 60% (`/compact`) o del 80% (`$bcx:handoff` y sesión nueva), y cuando tus límites de 5 h o semanal pasan del 75%. |

### Modos de prompt

| Escribe | Qué pasa |
| --- | --- |
| `+arregla el login` o `profundo: …` / `deep: …` | Investiga antes de editar, considera casos borde, verifica a fondo. |
| `rapido: …` / `quick: …` | El cambio mínimo, sin explorar de más, respuesta de máximo 5 líneas. |
| `pregunta: …` / `ask: …` | Solo responde; no edita archivos ni ejecuta cambios. |
| `plan: …` | Un plan numerado (archivos, riesgos, verificación) y espera tu aprobación. |

### Skills (plugin `bcx`)

| Skill | Para qué |
| --- | --- |
| `$bcx:commit` | Divide tus cambios en Conventional Commits por tema y hace push, solo commit o rama nueva. Nunca agrega secretos ni cambia tu identidad de git. |
| `$bcx:refine` | Convierte un pedido vago en un brief (objetivo, archivos, restricciones, criterios de aceptación, verificación) y luego lo ejecuta. |
| `$bcx:handoff` | Escribe `.codex/handoff.md` para seguir en una sesión nueva y barata; el brief de la siguiente sesión lo señala. |
| `$bcx:debug` | Reproducir, aislar, causa raíz, arreglo mínimo y prueba de regresión. |

## Seguridad

El **guard** revisa cada comando y cada parche antes de que corran. No mira solo el comando de afuera: también entra en los scripts que Codex ejecuta en modo código, los bloques `{ }` de PowerShell, lo que llega por tubería (`… | Remove-Item`, `… | xargs rm`), los scripts `.ps1`/`.sh`, lo que hace cada `npm run …` según tu `package.json`, el código de `node -e`/`python -c` y los scripts que el mismo Codex escribió en la sesión antes de ejecutarlos. Se detiene ante:

- **Borrados** que git no puede recuperar: carpetas completas, archivos sin commit o sin seguimiento, rutas fuera del repo, comodines, destinos en variables, `find … -delete`, `shutil.rmtree`/`fs.rmSync(…, {recursive})`. Borrar `node_modules`, `dist`, `build`, logs, temporales o archivos que el mismo Codex creó en la sesión no pregunta.
- **Descartar tus cambios sin commit**: `reset --hard`, `checkout -- …`, `restore`, `clean -f`, `stash drop`, `worktree remove --force`. Si solo se pierden cambios que Codex hizo en esta sesión, no pregunta.
- **Historial de git**: `push --force` (crítico en main), `--mirror`, borrar ramas o tags remotos, `branch -D`, `filter-branch`, `reset --hard` a otro commit.
- **Secretos**: leer `.env`, llaves, keystores o credenciales (su contenido se enviaría al modelo), volcar variables de entorno, sobrescribirlos o agregarlos a git.
- **Bases de datos**: `DROP`, `TRUNCATE`, `DELETE`/`UPDATE` sin `WHERE`, `prisma migrate reset`, `migrate:fresh`, `manage.py flush`, `FLUSHALL`…
- **Infraestructura y publicación**: `terraform destroy`, `kubectl delete`, `docker compose down -v`, `npm publish`, `firebase deploy`, hacer público un repo…
- **Cerrar programas por nombre**: `taskkill /IM chrome.exe`, `Stop-Process -Name node`, `pkill java` cierran también tus ventanas y servidores. Por PID no pregunta.
- **Tu configuración global**: `git config --global …` (tu identidad), `npm config set`, `setx`, variables de entorno de usuario o de máquina.
- **Sistema**: formatear discos, registro de Windows, borrar puntos de restauración, apagar el antivirus o el firewall, apagar el equipo, `curl … | bash`.

Así se ve:

```text
Tú:     sube los cambios aunque haya conflicto
Codex:  Quiero ejecutar `git push --force origin main`. Es necesario porque tu rama y el
        remoto divergieron. Riesgo: borraría los 2 commits que están solo en el remoto.
        Alternativa más segura: `git pull --rebase` y luego un push normal. ¿Lo autorizas?
        🛡 better-codex detuvo: Reescribir o borrar historial de git — `git push --force origin main`.
           Riesgo: puede borrar commits (también de otras personas en el remoto). Responde «sí» para permitirlo una vez.
Tú:     sí
```

La aprobación vale **para esa acción y solo en ese turno**: si Codex la reintenta con otra sintaxis (`rm -rf x` o `Remove-Item -Recurse x`) pasa, pero cualquier otra acción riesgosa vuelve a preguntar. «Sí, pero…», «espera» o cualquier otra respuesta la cancelan.

Casi siempre Codex pregunta **antes** de que el guard tenga que intervenir: las reglas que better-codex le da se lo piden. Tu «sí» a esa pregunta también cuenta, así que no tienes que confirmar dos veces. Eso sí, solo cubre lo que la pregunta mostraba: el comando exacto o las rutas exactas que nombró, para ese tipo de acción. Si Codex luego intenta otra cosa, o usa una variable (`$target`) en vez de la ruta, el guard lo detiene igual. Prueba un comando con `bcx guard "git reset --hard"`, revisa qué habría detenido en tus sesiones pasadas con `bcx audit`, y qué detuvo de verdad con `bcx log`.

El guard es una capa extra, no un reemplazo del sandbox y las aprobaciones de Codex: protege de los errores de un agente que coopera, no de uno malicioso. Ver [SECURITY.md](SECURITY.md).

## Medir

```bash
bcx stats            # tokens, caché, contexto medio y pico, herramientas por turno, sesiones más pesadas, antes/después
bcx usage            # tus límites de 5 h y semanal, con cuándo se reinician
bcx audit            # repasa tus sesiones pasadas: qué habría detenido el guard y qué habría ahorrado la dieta
bcx log              # lo último que hizo: bloqueos, aprobaciones, lecturas evitadas, verificaciones pedidas
bcx doctor           # instalación, hooks probados en tus shells, y lo que Codex ha enviado de verdad
bcx brief            # el resumen que recibe Codex en este repo, con su costo en tokens
bcx try "+arregla el login que truena"   # lo que se agregaría a ese prompt
```

`bcx stats` separa automáticamente las sesiones de antes y después de instalar, con la entrada por turno, las herramientas por turno y el contexto medio de cada grupo. Lo que hace better-codex queda en `~/.codex/better-codex/events.jsonl` (resúmenes, lecturas evitadas, paradas del guard, verificaciones pedidas).

El costo fijo de better-codex es de unos **660 tokens por sesión** (reglas y descripción de los skills, que se cachean), más hasta ~300 del brief y ~100 por prompt cuando hay algo útil que agregar.

## Configurar

```bash
bcx config                      # ver todo
bcx config set verifyGate off
bcx config set meter always     # una línea de contexto y límites en cada turno
bcx config reset
```

| Clave | Por defecto | Qué controla |
| --- | --- | --- |
| `guard` | `true` | Preguntar antes de acciones destructivas |
| `brief` | `true` | Resumen del repo al iniciar sesión |
| `boost` / `hints` | `true` | Modos y guías por prompt / rutas sugeridas |
| `diet` / `dietMaxKB` | `true` / `200` | Lecturas inútiles / tamaño máximo de lectura completa |
| `bigOutputKB` | `48` | Aviso de salida enorme (0 lo apaga) |
| `verifyGate` | `true` | Verificar antes de terminar |
| `meter` | `warn` | `warn` (solo umbrales), `always` u `off` |
| `ctxWarn` / `ctxCritical` | `60` / `80` | Umbrales de contexto (%) |
| `rateWarn` / `rateCritical` | `75` / `90` | Umbrales de límites del plan (%) |
| `lang` | `auto` | Idioma de los mensajes para ti (`es`, `en`); al modelo siempre en inglés |

## Cómo funciona

Codex ejecuta `node …/bin/bcx.js hook <Evento>` en cada evento, le pasa el evento en JSON por stdin y lee la respuesta por stdout ([referencia de hooks](https://learn.chatgpt.com/docs/hooks)). Los comandos usan rutas absolutas sin sintaxis de shell, así que funcionan igual en cmd, PowerShell, bash y zsh, también con espacios o acentos en la ruta; `bcx doctor` lo comprueba ejecutando cada hook en tus shells.

Robustez:

- Si algo falla adentro de un hook, Codex sigue como si no existiera; el error queda en `bcx log` y `bcx doctor`.
- Cada hook tarda entre 120 y 300 ms (Node reutiliza su caché de compilación). Sus `git status` no toman `index.lock`, para no chocar con los comandos de git de Codex.
- Los hooks de una misma sesión se turnan con un candado, así que las llamadas en paralelo no se pisan el estado; si el candado se queda colgado, a los 5 s se libera.
- Las rutas se comparan ya resueltas, así que los enlaces simbólicos (como `/var` → `/private/var` en macOS) no confunden "dentro del repo" con "fuera".

```text
bin/bcx.js        CLI y punto de entrada de los hooks
src/hooks.js      qué hace cada evento
src/guard.js      reglas de seguridad y aprobación
src/prompt.js     modos, tipos de tarea, rutas sugeridas
src/brief.js      resumen del repo · src/project.js  detección de stack y comandos
src/diet.js       lecturas inútiles · src/verify.js  verify gate
src/meter.js      avisos de contexto y límites · src/stats.js, src/audit.js  métricas
src/install.js    instalar, desinstalar · src/doctor.js  diagnóstico
templates/        bloque de AGENTS.md
plugins/bcx/      skills
```

## Limitaciones

- Los hooks no pueden cambiar el nivel de razonamiento por turno: `+` agrega instrucciones de profundidad, no sube el `reasoning effort`. Para eso usa `/model` en Codex.
- El formato de los archivos de sesión de Codex no es una interfaz estable. Si cambia, `stats`, `usage` y el meter dejan de mostrar datos, pero nada se rompe.
- `bcx audit` evalúa las reglas de git con el estado actual de cada repo, no con el de aquel momento.

## Desinstalar

```bash
node bin/bcx.js uninstall
```

Quita los hooks, el bloque de `AGENTS.md`, el marketplace y la copia instalada, sin tocar nada tuyo. Tus ajustes y métricas quedan en `~/.codex/better-codex/` por si vuelves; bórrala si no.

## Desarrollo

```bash
npm test          # 66 pruebas con node:test, sin dependencias
npm run check     # pruebas + doctor sin red
```

Las pruebas usan repos de git temporales y un `CODEX_HOME` aislado: nunca tocan tu `~/.codex`. La CI corre en Linux, macOS y Windows con Node 20, 22 y 24. Ver [CONTRIBUTING.md](CONTRIBUTING.md) y [CHANGELOG.md](CHANGELOG.md).

---

## English

better-codex adds hooks, skills and metrics to OpenAI Codex: a repo brief at session start, prompt modes (`+`, `quick:`, `ask:`, `plan:`) and task playbooks, a **guard** that stops destructive actions (deletes, discarding uncommitted work, force-push, DB drops, deploys, secrets) until you explicitly approve them, a token diet for lockfiles and build output, a verify gate before Codex finishes, and context/rate-limit warnings. `bcx stats`, `bcx usage` and `bcx audit` measure the effect on your own sessions. Install with `node bin/bcx.js install`, then trust the hooks in `/hooks`. Zero dependencies, everything local, MIT.

MIT © MarioACo
