#!/usr/bin/env sh
# Recorre el flujo del Walking Skeleton (DoD del Bolt 0) hasta la bitácora y el cierre (Bolt 5) contra una API en marcha con la semilla aplicada.
# Uso: API=http://localhost:3000/api sh scripts/flujo-e2e.sh   (requiere curl y node)
# Tokens: por defecto los usuarios demo de la semilla (solo desarrollo); en otro entorno, exportar
# TOKEN_GUARDAPARQUE, TOKEN_COORDINADOR y TOKEN_JEFE con tokens reales.
set -eu
API="${API:-http://localhost:3000/api}"
BRIGADA="00000000-0000-4000-8000-000000000203"   # Brigada Departamental 3 (San Ignacio), de la semilla
ID="$(node -e 'console.log(crypto.randomUUID())')"
HACE_UNA_HORA="$(node -e 'console.log(new Date(Date.now()-3600e3).toISOString())')"
# campo 'expr': imprime expr evaluada sobre la respuesta JSON, disponible como r.
campo() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log($1)})"; }
G="${TOKEN_GUARDAPARQUE:-demo-guardaparque}"
C="${TOKEN_COORDINADOR:-demo-coordinador}"
J="${TOKEN_JEFE:-demo-jefe-brigada}"
# post TOKEN RUTA JSON / get TOKEN RUTA
post() { curl -sf -X POST "$API$2" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' -d "$3"; }
get() { curl -sf "$API$2" -H "Authorization: Bearer $1"; }

echo "1) Reporte GPS a ~2 km de Concepción"
post "$G" /incidentes "{\"id\":\"$ID\",\"latitud\":-16.1153,\"longitud\":-62.0258,\"precisionMetros\":8,\"fechaReporte\":\"$HACE_UNA_HORA\"}" \
  | campo 'r.estado+" / riesgo "+r.nivelRiesgo+": "+r.justificacionRiesgo'
echo "2) Panel (columna Nuevo)"
get "$C" /panel | campo 'r.incidentes.Nuevo.length+" foco(s) en Nuevo"'
echo "3) Brigada sugerida"
get "$C" "/incidentes/$ID/brigadas-sugeridas" | campo 'r[0].nombre+" a "+r[0].distanciaKm+" km"'
echo "4) Carta municipal (Ley 602)"
printf '%%PDF-1.4\n%% Carta municipal de ejemplo %s\n%%%%EOF\n' "$ID" \
  | curl -sf -X POST "$API/incidentes/$ID/carta-municipal" -H "Authorization: Bearer $C" \
      -H 'Content-Type: application/pdf' -H 'x-fecha-emision: 2026-09-28' --data-binary @- \
  | campo 'r.estadoTramite+" ("+r.estado+")"'
echo "5) Despacho confirmado por el coordinador"
ASIG="$(post "$C" "/incidentes/$ID/asignaciones" "{\"brigadaId\":\"$BRIGADA\"}" | campo 'r.asignacion.id')"
echo "   asignación $ASIG"
echo "6) Llegada confirmada"
post "$J" "/asignaciones/$ASIG/llegada" '{"latitud":-16.1150,"longitud":-62.0255,"precisionMetros":10}' \
  | campo '"ΔT = "+r.deltaMinutos+" min, ahorro "+r.ahorroPct+" % vs. "+r.lineaBaseMinutos+" min"'
echo "7) Historial inmutable"
get "$C" "/incidentes/$ID/historial" | campo 'r.map(h=>h.estadoNuevo).join(" → ")'
echo "8) Bitácora de turno (checklist, Bolt 5)"
BIT="$(node -e 'console.log(crypto.randomUUID())')"
post "$J" "/incidentes/$ID/bitacoras" "{\"id\":\"$BIT\",\"nivelAgua\":\"Suficiente\",\"nivelCombustible\":\"Reserva\",\"herramientasOperativas\":true,\"kmFajaMitigados\":1.5,\"porcentajeControl\":60}" \
  | campo '"control "+r.porcentajeControl+" %, combustible "+r.nivelCombustible'
echo "9) Cierre en 1 clic con informe PDF inmutable"
post "$C" "/incidentes/$ID/cierre" '{"resultado":"Controlado"}' | campo 'r.resultado+" · ΔT "+r.tiempoTotalDespacho+" min · SHA-256 "+r.sha256.slice(0,16)+"…"'
curl -sf "$API/incidentes/$ID/informe/pdf" -H "Authorization: Bearer $C" | head -c 8; echo " (informe descargado)"
