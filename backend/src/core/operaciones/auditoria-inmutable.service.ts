import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * RNF-07: protección append-only en la propia BD, no solo en la API.
 * - historial_estado: se rechaza todo UPDATE, DELETE y TRUNCATE.
 * - incidente.fecha_reporte y asignacion_despacho.timestamp_confirmacion_llegada: write-once
 *   (una vez fijados no cambian), porque de ellos sale el ΔT del KPI.
 * Idempotente: se aplica en cada arranque mientras se use `synchronize`; con migraciones pasará a una migración.
 */
@Injectable()
export class AuditoriaInmutableService implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit(): Promise<void> {
    await this.dataSource.query(SQL_AUDITORIA);
  }
}

const SQL_AUDITORIA = `
CREATE OR REPLACE FUNCTION rechazar_modificacion_auditoria() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Registro de auditoría inmutable (RNF-07): % sobre % no permitido', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS historial_estado_append_only ON historial_estado;
CREATE TRIGGER historial_estado_append_only
  BEFORE UPDATE OR DELETE ON historial_estado
  FOR EACH ROW EXECUTE FUNCTION rechazar_modificacion_auditoria();

DROP TRIGGER IF EXISTS historial_estado_sin_truncate ON historial_estado;
CREATE TRIGGER historial_estado_sin_truncate
  BEFORE TRUNCATE ON historial_estado
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_modificacion_auditoria();

CREATE OR REPLACE FUNCTION proteger_fecha_reporte() RETURNS trigger AS $$
BEGIN
  IF NEW.fecha_reporte IS DISTINCT FROM OLD.fecha_reporte THEN
    RAISE EXCEPTION 'fecha_reporte es inmutable (RNF-07)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS incidente_fecha_reporte_inmutable ON incidente;
CREATE TRIGGER incidente_fecha_reporte_inmutable
  BEFORE UPDATE ON incidente
  FOR EACH ROW EXECUTE FUNCTION proteger_fecha_reporte();

CREATE OR REPLACE FUNCTION proteger_confirmacion_llegada() RETURNS trigger AS $$
BEGIN
  IF OLD.timestamp_confirmacion_llegada IS NOT NULL
     AND NEW.timestamp_confirmacion_llegada IS DISTINCT FROM OLD.timestamp_confirmacion_llegada THEN
    RAISE EXCEPTION 'timestamp_confirmacion_llegada es inmutable una vez registrado (RNF-07)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS asignacion_llegada_inmutable ON asignacion_despacho;
CREATE TRIGGER asignacion_llegada_inmutable
  BEFORE UPDATE ON asignacion_despacho
  FOR EACH ROW EXECUTE FUNCTION proteger_confirmacion_llegada();
`;
