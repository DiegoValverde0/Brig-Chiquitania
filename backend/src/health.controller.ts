import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Verificación mínima del Walking Skeleton: API viva y PostgreSQL alcanzable. */
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check(): Promise<{ status: string; db: string }> {
    await this.dataSource.query('SELECT 1');
    return { status: 'ok', db: 'up' };
  }
}
