# Contribuir

Sin dependencias: Node 20+ y git bastan.

```bash
npm test                          # node:test, repos y CODEX_HOME temporales; nunca toca tu ~/.codex
node bin/bcx.js doctor --offline  # ejecuta cada hook en tus shells reales
node bin/bcx.js audit --days 90   # repasa tus sesiones reales: los falsos positivos son bugs
```

## Reglas del guard

Cada regla nueva lleva pruebas en [test/guard.test.js](test/guard.test.js) de las dos caras: lo que debe detener y lo cotidiano que **no** debe detener (la lista `allowed` crece con cada falso positivo encontrado). Antes de abrir el PR, corre `bcx audit` sobre tus sesiones y compara cuántas veces preguntaría: si sube mucho, la regla es demasiado amplia.

Los textos que ve el modelo van en inglés y cortos; los que ves tú, en español e inglés (`RULES` en [src/guard.js](src/guard.js)).

## Hooks

Un hook nunca debe romper Codex: cada función va dentro de `safely()` en [src/hooks.js](src/hooks.js), y cualquier error queda en `~/.codex/better-codex/events.jsonl` (`bcx log`). Lo que se inyecta al modelo se queda en la conversación el resto de la sesión: cada línea debe ganarse su lugar.

## Commits

Conventional Commits (`feat(guard): …`, `fix(diet): …`), una cosa por commit. Actualiza [CHANGELOG.md](CHANGELOG.md) en la sección "Sin publicar".
