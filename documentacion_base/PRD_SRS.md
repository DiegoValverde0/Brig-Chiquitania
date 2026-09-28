# PRD / SRS — Priorización de Brigadas ante Focos de Calor en la Chiquitanía

> Transcripción resumida de la **Actividad 2** (PRD + SRS bajo IEEE Std 830, rev. 0, 02/09/2026 – 15/09/2026),
> UPDS – Ingeniería de Software I. Docente: Ing. Jimmy Nataniel Requena.

## 1. Contexto institucional (Ley N.º 602)
La atención de incendios forestales en Santa Cruz **no** es un despacho civil directo tipo 911. Rige el principio
de subsidiariedad:
1. **Nivel comunal:** comunarios y guardaparques hacen el ataque inicial.
2. **Nivel municipal:** la Unidad de Gestión de Riesgo (UGR) de la alcaldía interviene con recursos locales.
3. **Nivel departamental:** la Gobernación despliega brigadas de 2.ª/3.ª línea (acuarteladas en Santa Cruz de la
   Sierra) **solo** cuando el municipio declara su capacidad rebasada y envía una **carta formal de solicitud**.

El tiempo muerto crítico no es logístico (el personal está listo en base) sino **administrativo** (latencia del
trámite) y la **dispersión informativa** en campo.

## 2. PRD

### 2.1 Problema y dolor operativo
- Crisis recurrentes (2019, 2024: >10 millones de ha). El tiempo entre avistamiento y despacho se mide en horas o días.
- Doble dolor: (a) incertidumbre del coordinador durante el trámite institucional; (b) caos informativo del jefe
  de brigada: tras abandonar una app previa por fallas de sincronización offline, se reporta por **grupos de
  WhatsApp**, y armar el informe de cierre obliga a revisar cientos de mensajes.

### 2.2 Objetivo
Reducir en un **30 %** el tiempo de despacho (reporte georreferenciado → confirmación de llegada al punto GPS),
con timestamps inmutables en cada transición (**Nuevo → Asignado → En atención → En Liquidación → Cerrado**),
contra la línea base de **180 min** (temporada 2024).

### 2.3 Usuarios y stakeholders
- **Usuarios directos:** Guardaparque/Comunario (reporta), Coordinador de despacho (evalúa, gestiona trámite,
  asigna), Jefe de brigada/Bombero forestal (confirma llegada, documenta, cierra).
- **Stakeholder primario:** Eddy Chura, Bombero Forestal Departamental (Gobernación de Santa Cruz).
- **Otros:** Responsable UGR municipal (emite la carta), Autoridad/Referente comunal (contacto obligatorio),
  docente/sponsor, autoridades de gestión de riesgos, donantes, equipo AI Pod.

### 2.4 Alcance del MVP
**Incluye:** los 5 casos de uso núcleo (reporte → riesgo → panel → despacho → llegada/bitácora/cierre);
arquitectura de microsistema offline-first con control humano; canal SMS de contingencia; adjunto de carta
municipal digitalizada; estado táctico "En Liquidación / Por Finalizar"; bitácora por checklist; informe
consolidado en 1 clic.

**Fuera:** modelos predictivos del fuego, nómina, meteorología avanzada, ingesta satelital (NASA FIRMS/VIIRS),
inventario de insumos.

### 2.5 Restricciones y supuestos
- Bolts sucesivos iniciando con un *walking skeleton* E2E.
- Sin presupuesto de hardware: dispositivos existentes, Android 5.0+, ≤1 GB RAM.
- GPS nativo crudo, sin mapas interactivos; SQLite local con sync idempotente a SGBD central ACID; SMS <160.
- Red 2G intermitente (restricción de campo, no de la Ley 164).
- Cifrado en tránsito y reposo (RNF-08) por Ley 164.
- Despacho condicionado a carta municipal (Ley 602).

### 2.6 Criterios de aceptación (nivel PRD)
- Un foco recorre todo el ciclo de vida y el sistema calcula el tiempo total de despacho.
- Opera offline y sincroniza sin pérdida al recuperar conectividad.
- Cada caso de uso tiene ≥1 HU Gherkin trazable.
- El despacho queda bloqueado sin carta municipal adjunta.
- Permite comparar contra la línea base de 180 min.

## 3. SRS — Historias de usuario (Gherkin resumido)

### CU1 — Reporte georreferenciado
- **HU-1.1** Captura GPS + foto comprimida. *Dado* GPS activo, *cuando* "Capturar Coordenadas", *entonces*
  lat/lng decimal <15 m, foto ≤100 KB sin detener la alerta, sin mapas interactivos. — RF-01, RF-03, RNF-01, RNF-08, RS-01, RS-02
- **HU-1.2** Reporte a distancia: comunidad más cercana + rumbo (N/S/E/O) + distancia estimada → ubicación aproximada. — RF-01, RNF-01
- **HU-1.3** Fallback SMS: si falla HTTP/TCP, empaqueta la carga útil en <160 caracteres y la envía por SMS. — RNF-02, RS-02
- **HU-1.4 (nueva)** Contacto comunal obligatorio: al asociar la comunidad más próxima se extrae nombre y
  teléfono del referente desde el catálogo offline, y se valida no vacío antes de habilitar el despacho. — RF-02, RNF-08, RS-01, RS-03

### CU2 — Evaluación de riesgo
- **HU-2.1 (actualizada)** Motor de reglas: distancia euclidiana a asentamientos; **Alta** si <5 km de comunidad
  habitada; excluye estancias privadas; justificación "Amenaza directa a vida humana comunitaria". — RF-04, RF-05, RNF-04, RS-03
- **HU-2.2** Reclasificación manual: bloquea guardado si la justificación <15 caracteres; registra quién, cuándo y motivo. — RF-06

### CU3 — Panel de control de emergencias (COED)
- **HU-3.1 (actualizada)** Filtro "Con Solicitud Municipal Formal" y estados de cuadrillas: Disponible,
  En Desplazamiento, En Combate Activo, En Liquidación. — RF-07, RF-08, RNF-05

### CU4 — Asignación y despacho
- **HU-4.1** Sugerencia de brigadas ordenadas por cercanía y disponibilidad (foco Alto/Medio). — RF-09
- **HU-4.2** Notificación Web Push o SMS (ubicación, ruta, contacto comunal); foco pasa a "Asignado" con cronómetro inmutable. — RF-10, RF-11, RNF-02
- **HU-4.3 (nueva)** Reasignación táctica: brigada "En Liquidación" a <30 km de un foco crítico reactivado se
  sugiere y se despacha en 1 clic, notificando por SMS. — RF-08, RF-10, RNF-02, RS-03

### CU5 — Llegada, bitácora y cierre
- **HU-5.1** Confirmar llegada: registra hora y GPS; foco pasa a "En atención". — RF-14
- **HU-5.2 (nueva)** Bitácora por checklist offline (agua Suficiente/Crítica; combustible OK/Reserva;
  herramientas Operativas; km de faja; % de control); persiste en SQLite y encola sync <1 KB. — RF-12, RNF-01, RS-02, RS-03
- **HU-5.3** ΔT = T_llegada − T_reporte y % de ahorro vs. 180 min, verificable contra el historial inmutable. — RF-14, RNF-07
- **HU-5.4 (nueva)** Informe consolidado en 1 clic: compila bitácoras en PDF inmutable; exige justificación si el cierre es "Falso positivo". — RF-13, RF-14, RNF-07, RS-03

## 4. Requisitos (24)
> Se conserva la numeración original: no existen RNF-03 ni RNF-06.

| ID | Subcategoría | Descripción |
|---|---|---|
| RF-01 | Captura | Captura GPS cruda (≤15 m) sin capas interactivas en línea |
| RF-02 | Captura | Reporte a distancia por hitos cardinales y contacto comunal obligatorio |
| RF-03 | Captura | Fotografía ultracomprimida opcional (≤100 KB) con timestamp |
| RF-04 | Procesamiento | Motor de riesgo <5 s jerarquizando vida comunitaria (excluye predios privados) |
| RF-05 | Procesamiento | Explicabilidad algorítmica de los factores de riesgo |
| RF-06 | Procesamiento | Reclasificación manual con justificación obligatoria |
| RF-07 | Visualización | Panel Kanban con filtro de trámite y carta municipal formal |
| RF-08 | Visualización | 4 estados de brigada (incluye "En Liquidación") |
| RF-09 | Despacho | Sugerencia automática de la cuadrilla disponible más cercana |
| RF-10 | Despacho | Despacho en 1 clic y reasignación en campo con timestamp inmutable |
| RF-11 | Despacho | Notificación dual: Web Push y fallback SMS |
| RF-12 | Cierre | Bitácora de turno con checklist operativo (reemplaza WhatsApp) |
| RF-13 | Cierre | Consolidación automática del informe técnico final |
| RF-14 | Cierre | Medición automática de ΔT vs. línea base (KPI 30 %) |
| RNF-01 | Disponibilidad / Offline | Persistencia local y sincronización transaccional idempotente |
| RNF-02 | Confiabilidad | Canal SMS plano (≤160 caracteres) para redes 2G |
| RNF-04 | Rendimiento | Motor de riesgo ≤5 s con 50+ focos activos |
| RNF-05 | Escalabilidad / Usabilidad | Kanban operable y legible con 50+ incidentes |
| RNF-07 | Integridad / Auditabilidad | Registro inmutable (append-only) con timestamps de todo el ciclo |
| RNF-08 | Seguridad / Privacidad | Ubicación, fotos y contactos cifrados; acceso por rol |
| RNF-09 | Disponibilidad | Backend ≥99 % en temporada de incendios (mayo–octubre) |
| RS-01 | Inclusión digital rural | Android 5.0+, RAM ≤1 GB, sin librerías pesadas ni cartografía propietaria |
| RS-02 | Sobriedad computacional | Batería <2 % por ciclo; paquetes <2 KB en texto plano |
| RS-03 | Explicabilidad / racionalidad | Prohibido el despacho automatizado a ciegas; justificación en reclasificaciones y falsos positivos |

## 5. Matriz de trazabilidad (resumen)
| ID | Origen principal | CU | HU | Criterio verificable | Evidencia QA |
|---|---|---|---|---|---|
| RF-01 | Acta (Avenza Maps); Ley 164 art. 71 | CU1 | 1.1 | lat/lng decimal ≤2 s sin APIs de mapas | Dispositivo en modo avión con GPS |
| RF-02 | Acta ("contacto mandatorio"); Ley 602 | CU1 | 1.2, 1.4 | Bloquea despacho si el contacto está vacío | Formulario offline vs. catálogo SQLite |
| RF-03 | AGETIC | CU1 | 1.1 | Imagen comprimida sin detener la alerta | Metadatos EXIF y peso |
| RF-04 | Acta (triaje ético); Ley 602 | CU2 | 2.1 | "Alta" si <5 km de poblado | Test unitario con comunidades reales |
| RF-05 | Ética IA (Floridi) | CU2 | 2.1 | Muestra variables evaluadas | Inspección UI / usabilidad |
| RF-06 | Human-in-the-loop; Ley 602 | CU2 | 2.2 | Bloquea si justificación <15 car. | Test de validación |
| RF-07 | Acta; Ley 602 | CU3 | 3.1 | Discrimina focos con carta UGR | Test de filtros Kanban |
| RF-08 | Acta (Concepción 2024) | CU3, CU4 | 3.1, 4.3 | Muestra cuadrillas por liberarse | Componentes reactivos |
| RF-09 | Fundación TIERRA 2024 | CU4 | 4.1 | Orden por distancia euclidiana | Test del algoritmo de cercanía |
| RF-10 | Acta; Ley 602 | CU4 | 4.2, 4.3 | "Asignado" + cronómetro inmutable | INSERT append-only |
| RF-11 | Acta; Ley 164 art. 59.4 | CU4 | 4.2 | SMS con coordenadas y contacto si no hay 4G | Pasarela SMS |
| RF-12 | Acta (autopsia / WhatsApp) | CU5 | 5.2 | Checklist (agua, combustible, herramientas, km) | Modo avión + sync asíncrono |
| RF-13 | Acta; Ley 602 | CU5 | 5.4 | PDF inmutable con todas las bitácoras | Compilación con bitácoras de prueba |
| RF-14 | Línea base 2024 (180 min) | CU5 | 5.3 | ΔT y % de ahorro | Test matemático vs. SGBD |
| RNF-01 | Acta (fallas del legado) | Transversal | 1.1, 5.2 | Cero pérdida, sin duplicados | Corte de enlace prolongado |
| RNF-02 | Restricción de campo; Ley 164 | CU1, CU4 | 1.3, 4.2 | Empaquetado al fallar TCP | Módem GSM con señal degradada |
| RNF-04 | Acta | CU2 | 2.1 | <5 s con 50+ focos | Prueba de carga |
| RNF-05 | Acta | CU3 | 3.1 | Legible con 50+ incidentes | Usabilidad con datos simulados |
| RNF-07 | Ley 602; Acta | CU5 | 5.3, 5.4 | Historial no editable | Intento de edición debe fallar |
| RNF-08 | Ley 164 | CU1 | 1.1, 1.4 | Cifrado tránsito/reposo | Checklist de seguridad + roles |
| RNF-09 | Ley 602 | Transversal | Todas | ≥99 % mayo–octubre | Monitoreo de uptime |
| RS-01 | Ley 164 art. 71; AGETIC | CU1 | 1.1, 1.4 | RAM ≤120 MB, sin 3D ni mapas | Emulador de 1 GB RAM |
| RS-02 | Acta; Green Computing | CU1, CU5 | 1.1, 5.2 | Paquetes crudos <2 KB | Android Battery Profiler |
| RS-03 | Ley 300; Ley 602 | CU2, CU4, CU5 | 2.1, 4.3, 5.2 | Sin despachos a ciegas; auditoría de falsas alarmas | Análisis de bitácoras |
