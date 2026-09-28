import { Client } from 'pg';

/**
 * Prepara una BD de pruebas vacía (por defecto `chiquitania_test`, en el mismo servidor que .env / docker compose).
 * Se borra el esquema completo porque historial_estado rechaza DELETE y TRUNCATE (RNF-07).
 */
export async function prepararBdPruebas(): Promise<void> {
  const nombre = process.env.DB_NAME_TEST ?? 'chiquitania_test';
  const conexion = {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'chiquitania',
    password: process.env.DB_PASSWORD ?? 'chiquitania_dev',
  };
  const admin = new Client({ ...conexion, database: 'postgres' });
  await admin.connect();
  const existe = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombre]);
  if (existe.rowCount === 0) await admin.query(`CREATE DATABASE "${nombre}"`);
  await admin.end();

  const bd = new Client({ ...conexion, database: nombre });
  await bd.connect();
  await bd.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await bd.end();

  process.env.DB_NAME = nombre;
  process.env.DB_SYNCHRONIZE = 'true';
}
