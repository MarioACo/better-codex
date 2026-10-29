# Seguridad

[English](SECURITY.md) · **Español**

## Qué protege el guard, y qué no

El guard te protege de **los errores de un agente que coopera**: un `rm -rf` de más, un `reset --hard` sobre tu trabajo sin commit, un `push --force` a main, o leer un `.env` cuyo contenido luego viaja al modelo.

Revisa cada comando y parche antes de que corran, incluidos:

- los scripts de modo código;
- los bloques `{ }` de PowerShell;
- los comandos por tubería;
- los scripts `.ps1` y `.sh`;
- los scripts de `package.json`;
- el código que Codex escribió antes en la sesión y luego ejecuta;
- tus alias y funciones de la terminal (`nuke tmp` cuando `nuke` es `rm -rf`);
- el base64 que puede decodificar (`-EncodedCommand`, `base64 -d`). El texto que se arma al correr (`eval "$CMD"`, `… | bash`) pregunta antes.

**No es un sandbox, y no protege contra un agente malicioso.** Analiza el texto de los comandos con heurísticas, así que un programa lo bastante indirecto puede pasar. Úsalo junto con el sandbox y las aprobaciones de Codex, no en su lugar.

## Tus datos

Todo corre en tu máquina, y better-codex no hace llamadas de red. Guarda su estado y métricas en `~/.codex/better-codex/`:

- **Estado por sesión**: el último prompt que enviaste y la última respuesta de Codex. Sirve para ligar un «sí» a la pregunta que responde, y se borra a los 7 días.
- **Tus perfiles de terminal** (perfil de PowerShell, `.bashrc`, `.zshrc` y los archivos que cargan dentro de tu carpeta personal) se leen como texto para expandir tus alias. Nada de ellos se ejecuta ni se guarda. En Windows recuerda dónde está tu carpeta Documentos (`shell.json`).
- **Copias para `bcx undo`**: antes de una acción que aprobaste, los archivos que borraría o sobrescribiría van a `~/.codex/better-codex/undo/`, y eso puede incluir un `.env`. En comandos de git, la foto también se guarda como objetos de git en `refs/bcx/undo/` dentro de tu repo. Se quedan en tu máquina: `git push` no envía esas referencias, pero `git push --mirror` sí lo haría, y el guard pregunta antes. Solo se conservan las últimas 20 copias de los últimos 14 días. `bcx config set undo off` lo apaga.
- **Métricas** (`events.jsonl`): no guardan prompts. Sí registran los comandos que el guard detuvo o permitió y las rutas que la dieta evitó leer, recortados a 160 caracteres. El archivo rota al llegar a 2 MB, y `BCX_NO_METRICS=1` apaga las métricas.

## Versiones con soporte

Los arreglos van a la versión más reciente. Actualiza con `git pull` y `node bin/bcx.js install`.

## Reportar un hueco

Si encuentras un comando destructivo que el guard deja pasar, o uno inofensivo que detiene sin motivo:

1. Comprueba qué decide hoy con `bcx guard "<comando>"`.
2. [Abre un issue](https://github.com/MarioACo/better-codex/issues) con el comando (sin datos privados), qué esperabas y qué pasó.

**Si el hueco deja pasar algo grave sin preguntar** (borrar datos, filtrar secretos), por favor repórtalo primero en privado, con el botón **Report a vulnerability** de la pestaña **Security** del repositorio, y no en un issue público.
