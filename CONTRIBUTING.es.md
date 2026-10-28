# Contribuir

[English](CONTRIBUTING.md) · **Español**

Sin dependencias: Node 20+ y git bastan.

```bash
npm test                          # node:test con repos y CODEX_HOME temporales; nunca toca tu ~/.codex
node bin/bcx.js doctor --offline  # ejecuta cada hook en tus terminales reales
node bin/bcx.js audit --days 90   # repasa tus sesiones reales: los falsos positivos son bugs
```

## Pruébalo en una sesión real de Codex

Las pruebas ejecutan los hooks como los llama Codex, pero quien tiene la última palabra es el propio Codex. Si tu cambio afecta lo que Codex ve o hace, pruébalo en una sesión real sobre un repo desechable:

```bash
node bin/bcx.js install                                  # actualiza la copia instalada; tu aprobación sigue válida si hooks.json no cambió
codex exec -C <repo-desechable> --json "<un prompt que ponga a prueba tu cambio>"
node bin/bcx.js log                                      # qué hizo better-codex en esa sesión
```

Varios bugs solo aparecieron así:

- una confirmación que se pedía dos veces;
- `npm.cmd test`, que no contaba como verificación;
- llamadas a la terminal que fallaban en cada sesión.

## Reglas del guard

Cada regla nueva lleva pruebas en [test/guard.test.js](test/guard.test.js) de las dos caras:

- lo que debe detener;
- lo cotidiano que **no** debe detener. La lista `allowed` crece con cada falso positivo encontrado.

Antes de abrir el PR, corre `bcx audit` sobre tus sesiones y compara cuántas veces preguntaría. Si sube mucho, la regla es demasiado amplia.

Los textos que lee el modelo van en inglés y cortos. Los que lees tú, en español e inglés (`RULES` en [src/guard.js](src/guard.js)).

## Hooks

Un hook nunca debe romper Codex:

- Cada función va dentro de `safely()` en [src/hooks.js](src/hooks.js).
- Cualquier error queda en `~/.codex/better-codex/events.jsonl`, donde lo muestra `bcx log`.

Lo que se inyecta al modelo se queda en la conversación el resto de la sesión, así que cada línea debe ganarse su lugar.

## Documentación

El README, esta guía, la política de seguridad y el registro de cambios están en inglés y español (`*.es.md`). Si cambias una versión, cambia las dos, o di en el PR cuál falta. Las demos animadas de `docs/` salen de `node scripts/demo-svg.mjs`; agrega `--static` para revisar el diseño con todas las líneas visibles.

## Commits

Usa Conventional Commits (`feat(guard): …`, `fix(diet): …`), un cambio por commit. Anota tu cambio en **Sin publicar** en [CHANGELOG.es.md](CHANGELOG.es.md) y [CHANGELOG.md](CHANGELOG.md).
