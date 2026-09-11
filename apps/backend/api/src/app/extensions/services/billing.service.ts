import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { MeteringRecord, MeteringStatus } from '../entities/metering-record.entity';

export interface BillingReport {
  organizationId: string;
  plugins: {
    pluginId: string;
    invocations: number;
    totalComputeTimeMs: number;
    avgMemoryBytes: number;
    totalEgressCount: number;
    failureRate: number;
  }[];
  generatedAt: Date;
}

/**
 * Rolls metering records up into a per-tenant, per-extension reconciliation report — the basis for
 * usage-based extension billing. Ported from plugin-host onto TypeORM.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(MeteringRecord)
    private readonly repo: Repository<MeteringRecord>,
  ) {}

  async generateReconciliationReport(
    organizationId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<BillingReport> {
    this.logger.log(
      `Generating extension billing report for org ${organizationId} from ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    const records = await this.repo.find({
      where: { organizationId, timestamp: Between(startDate, endDate) },
    });

    const pluginGroups = new Map<string, MeteringRecord[]>();
    for (const r of records) {
      const group = pluginGroups.get(r.pluginId) || [];
      group.push(r);
      pluginGroups.set(r.pluginId, group);
    }

    const report: BillingReport = { organizationId, plugins: [], generatedAt: new Date() };
    for (const [pluginId, groupRecords] of pluginGroups.entries()) {
      const totalComputeTimeMs = groupRecords.reduce((sum, r) => sum + r.executionTimeMs, 0);
      const totalMemory = groupRecords.reduce((sum, r) => sum + Number(r.memoryBytes), 0);
      const totalEgress = groupRecords.reduce((sum, r) => sum + r.egressCount, 0);
      const failures = groupRecords.filter((r) => r.status === MeteringStatus.FAILURE).length;
      report.plugins.push({
        pluginId,
        invocations: groupRecords.length,
        totalComputeTimeMs,
        avgMemoryBytes: Math.round(totalMemory / groupRecords.length),
        totalEgressCount: totalEgress,
        failureRate: failures / groupRecords.length,
      });
    }
    return report;
  }
}
