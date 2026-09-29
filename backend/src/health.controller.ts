import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Publico } from './core/seguridad/decoradores';

/** Verificación mínima del Walking Skeleton: API viva y PostgreSQL alcanzable. Sin token (monitoreo, RNF-09). */
@Publico()
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check(): Promise<{ status: string; db: string }> {
    await this.dataSource.query('SELECT 1');
    return { status: 'ok', db: 'up' };
  }
}
