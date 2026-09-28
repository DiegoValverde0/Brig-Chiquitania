#!/usr/bin/env sh
# Recorre el flujo del Walking Skeleton (DoD del Bolt 0) contra una API en marcha con la semilla aplicada.
# Uso: API=http://localhost:3000/api sh scripts/flujo-e2e.sh   (requiere curl y node)
set -eu
API="${API:-http://localhost:3000/api}"
BRIGADA="00000000-0000-4000-8000-000000000203"   # Brigada Departamental 3 (San Ignacio), de la semilla
ID="$(node -e 'console.log(crypto.randomUUID())')"
HACE_UNA_HORA="$(node -e 'console.log(new Date(Date.now()-3600e3).toISOString())')"
# campo 'expr': imprime expr evaluada sobre la respuesta JSON, disponible como r.
campo() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log($1)})"; }
post() { curl -sf -X POST "$API$1" -H 'Content-Type: application/json' -d "$2"; }

echo "1) Reporte GPS a ~2 km de Concepción"
post /incidentes "{\"id\":\"$ID\",\"latitud\":-16.1153,\"longitud\":-62.0258,\"precisionMetros\":8,\"fechaReporte\":\"$HACE_UNA_HORA\"}" \
  | campo 'r.estado+" / riesgo "+r.nivelRiesgo+": "+r.justificacionRiesgo'
echo "2) Panel (columna Nuevo)"
curl -sf "$API/panel" | campo 'r.incidentes.Nuevo.length+" foco(s) en Nuevo"'
echo "3) Brigada sugerida"
curl -sf "$API/incidentes/$ID/brigadas-sugeridas" | campo 'r[0].nombre+" a "+r[0].distanciaKm+" km"'
echo "4) Carta municipal (Ley 602)"
post "/incidentes/$ID/carta-municipal" '{"archivoDigital":"cartas/ejemplo.pdf","fechaEmision":"2026-09-28"}' | campo 'r.estadoTramite'
echo "5) Despacho confirmado por el coordinador"
ASIG="$(post "/incidentes/$ID/asignaciones" "{\"brigadaId\":\"$BRIGADA\"}" | campo 'r.asignacion.id')"
echo "   asignación $ASIG"
echo "6) Llegada confirmada"
post "/asignaciones/$ASIG/llegada" '{"latitud":-16.1150,"longitud":-62.0255,"precisionMetros":10}' \
  | campo '"ΔT = "+r.deltaMinutos+" min, ahorro "+r.ahorroPct+" % vs. "+r.lineaBaseMinutos+" min"'
echo "7) Historial inmutable"
curl -sf "$API/incidentes/$ID/historial" | campo 'r.map(h=>h.estadoNuevo).join(" → ")'
