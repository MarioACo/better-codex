# Seguridad

## Qué protege el guard, y qué no

El guard protege contra **errores de un agente que coopera**: un `rm -rf` de más, un `reset --hard` sobre tu trabajo sin commit, un `push --force` a main, leer un `.env` que luego viaja al modelo. Revisa cada comando y parche antes de que corran, incluidos los scripts de modo código, los bloques `{ }` de PowerShell, los comandos por tubería, los scripts `.ps1`/`.sh`, los scripts de `package.json` y el código que Codex escribió en la sesión y luego ejecuta.

No es un sandbox ni protege contra un agente malicioso: analiza texto con heurísticas, así que un programa lo bastante indirecto puede pasar. Úsalo junto con el sandbox y las aprobaciones de Codex, no en su lugar.

Todo corre en tu máquina. better-codex no hace llamadas de red; guarda su estado y métricas en `~/.codex/better-codex/` (el último prompt de cada sesión se guarda localmente y se borra a los 7 días; las métricas no guardan prompts).

## Reportar un hueco

Si encuentras un comando destructivo que el guard deja pasar, o uno inofensivo que detiene sin motivo:

1. Comprueba con `bcx guard "<comando>"` qué decide hoy.
2. Abre un issue con el comando (sin datos privados), qué esperabas y qué pasó.

Para un hueco que permita algo grave sin preguntar (borrar datos, filtrar secretos), escribe primero por privado al autor desde su perfil de GitHub antes de publicarlo.
