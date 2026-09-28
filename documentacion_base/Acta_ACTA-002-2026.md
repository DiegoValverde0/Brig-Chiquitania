# Acta de Reunión ACTA-002-2026

> Transcripción resumida del acta con el stakeholder operativo.

## Datos generales
- **Proyecto:** Sistema de Apoyo a la Decisión para la Priorización de Brigadas ante Focos de Calor en la Chiquitanía (MVP)
- **Fecha:** 14/09/2026, 22:30–23:30 (llamada de audio, modalidad virtual sincrónica)
- **Tipo:** elicitación técnica y validación de requerimientos; autopsia de sistema legado; refinamiento de criterios de aceptación.

## Asistentes
- **Eddy Chura** — Bombero Forestal Departamental (stakeholder operativo primario / experto de dominio, Dirección de Recursos Naturales, Gobernación de Santa Cruz).
- **Diego Valverde** — Product Owner e Ingeniería de Requerimientos (AI Pod UPDS).
- **Jorge Gutierrez** — Arquitecto de Software y QA (AI Pod UPDS).
- *Ausente justificado:* **Jhonny Pérez** — Modelado de procesos y BD / SGBD.

## Agenda
1. Flujo institucional y subsidiariedad (Ley N.º 602): comunal → municipal (UGR) → departamental.
2. Autopsia del sistema legado (app de llegada/insumos/bitácora abandonada por fallas de sincronización offline).
3. Diagnóstico de la contingencia actual por grupos de WhatsApp.
4. Interfaz táctica y bitácora de campo (checklists: agua, combustible, herramientas; km de faja, % de control).
5. Visibilidad multi-brigada y reasignación (crisis 2024, Concepción y San Rafael; estado "En Liquidación / Por Finalizar").
6. Telecomunicaciones: mapas cacheados offline (tipo Avenza Maps), SMS <160 car. en 2G, contacto comunal obligatorio.

## Acuerdos y decisiones
1. **Despacho condicionado a solicitud formal (Ley 602).** La Gobernación es 2.ª/3.ª línea; la demora es la carta
   de la alcaldía. *Decisión:* cargar la carta digitalizada (PDF o imagen liviana) como prerrequisito legal para
   habilitar el despacho en un clic, con respaldo administrativo inmutable.
2. **Tolerancia a fallos offline.** El sistema previo duplicaba/corrompía datos al recuperar señal.
   *Decisión:* arquitectura **Offline-First estricta**, transacciones atómicas en almacenamiento local
   (IndexedDB/SQLite), sincronización asíncrona y ligera con colas robustas; sin funcionalidades innecesarias.
3. **Bitácora rápida e informe en 1 clic (reemplazo de WhatsApp).** *Decisión:* "Bitácora de Turno" en CU5 con
   checklists (combustible OK/Crítico; agua OK/Baja; herramientas Operativas) y campos numéricos (km de línea
   mitigada, % de avance); al cerrar se genera el "Informe Técnico Consolidado de Incidente".
4. **Estado "En Liquidación / Por Finalizar".** Evita enviar unidades desde la capital (300 km) cuando hay una
   cuadrilla vecina liberándose. *Decisión:* el panel la muestra como recurso táctico para reasignación inmediata.
5. **Cartografía offline y contacto comunal obligatorio.** *Decisión:* no renderizar mapas en línea; fallback SMS
   <160 car. en 2G; nombre y teléfono del cacique/corregidor/referente comunal como campo obligatorio de la orden de salida.

## Compromisos
| Tarea | Responsable | Fecha |
|---|---|---|
| Actualizar el PRD (autopsia, WhatsApp, subsidiariedad) | Diego Valverde | 15/09/2026 |
| Ajustar la SRS (Gherkin para bitácora, informe, "En Liquidación") | Diego Valverde | 16/09/2026 |
| Actualizar la RTM (vincular al acta y a la Ley 602) | Jorge Gutierrez | 16/09/2026 |
| Rediseñar el modelo de datos: tablas `Bitacora_Turno`, `Documento_Solicitud_Municipal`, estado `En_Liquidacion` | Jhonny Pérez | 16/09/2026 |
| Actualizar la matriz de auditoría de IA (despacho 911 vs. subsidiariedad; lección del legado) | Jorge Gutierrez | 16/09/2026 |
| Consolidación y revisión técnica del documento | Equipo AI Pod | 16/09/2026 |
