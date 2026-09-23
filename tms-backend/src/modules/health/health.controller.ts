import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface IndicatorResult {
  status: 'up' | 'down';
  message?: string;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  uptime: number;
  timestamp: string;
  details: {
    database: IndicatorResult;
  };
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Liveness + readiness probe. Returns 503 when a dependency is down. */
  @Get()
  async check(): Promise<HealthResponse> {
    const database = await this.pingDatabase();

    const response: HealthResponse = {
      status: database.status === 'up' ? 'ok' : 'error',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      details: { database },
    };

    if (response.status === 'error') {
      throw new ServiceUnavailableException(response);
    }

    return response;
  }

  private async pingDatabase(): Promise<IndicatorResult> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'up' };
    } catch (error) {
      return { status: 'down', message: (error as Error).message };
    }
  }
}
