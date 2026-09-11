import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MeteringRecord, MeteringStatus } from '../entities/metering-record.entity';

/**
 * Appends one usage record per extension execution. Ported from the standalone plugin-host and
 * re-homed onto the platform's TypeORM data source (the original used MikroORM).
 */
@Injectable()
export class MeteringService {
  constructor(
    @InjectRepository(MeteringRecord)
    private readonly repo: Repository<MeteringRecord>,
  ) {}

  async recordExecution(data: {
    organizationId: string;
    pluginId: string;
    version: string;
    executionTimeMs: number;
    memoryBytes: number;
    egressCount: number;
    success: boolean;
  }): Promise<string> {
    const record = this.repo.create({
      organizationId: data.organizationId,
      pluginId: data.pluginId,
      pluginVersion: data.version,
      executionTimeMs: data.executionTimeMs,
      memoryBytes: data.memoryBytes,
      egressCount: data.egressCount,
      status: data.success ? MeteringStatus.SUCCESS : MeteringStatus.FAILURE,
    });
    const saved = await this.repo.save(record);
    return saved.id;
  }
}
