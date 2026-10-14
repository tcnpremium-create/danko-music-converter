---
name: restore-point
description: Crea un punto de restauración local (tag git + bundle) antes de cambios importantes. Úsala antes de refactors, migraciones o ediciones masivas.
---
Ejecuta `bash .claude/skills/restore-point/create.sh "<motivo-corto>"`.
Crea un tag git local `restore/<fecha>-<motivo>` y un bundle en `.claude/restore/` (ignorado por git). No toca el árbol de trabajo.
Para restaurar: `git checkout <tag>` en una rama nueva (pide permiso al usuario antes).
