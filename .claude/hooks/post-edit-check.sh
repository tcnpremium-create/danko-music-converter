#!/usr/bin/env bash
# PostToolUse: tras editar TS/JS, comprueba tipos/sintaxis rápido. Solo informa (exit 2 = aviso a Claude).
f=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).tool_input||{}).file_path||"")}catch{}})')
[ -f "$f" ] || exit 0
case "$f" in
  *.ts|*.tsx)
    d=$(dirname "$f")
    while [ "$d" != "/" ] && [ ! -f "$d/tsconfig.json" ]; do d=$(dirname "$d"); done
    if [ -f "$d/tsconfig.json" ] && [ -x "$d/node_modules/.bin/tsc" ]; then
      out=$(cd "$d" && timeout 90 node_modules/.bin/tsc --noEmit 2>&1 | head -15)
      if [ -n "$out" ]; then echo "tsc --noEmit reporta errores:" >&2; echo "$out" >&2; exit 2; fi
    fi ;;
  *.js|*.mjs|*.cjs) node --check "$f" 2>&1 | head -5 >&2 || true ;;
esac
exit 0
