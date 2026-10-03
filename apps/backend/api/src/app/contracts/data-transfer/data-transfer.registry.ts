import { Injectable } from '@nestjs/common';
import { DataTransferDataset } from './data-transfer.contract';

/**
 * The datasets the domains have offered (see `DataTransferDataset`). Domains register in
 * `onModuleInit`; `data-transfer` reads. Neither side imports the other.
 */
@Injectable()
export class DataTransferRegistry {
  private readonly datasets = new Map<string, DataTransferDataset>();

  register(dataset: DataTransferDataset): void {
    // Idempotent: a module initialised twice in a test harness must not duplicate a dataset.
    if (!this.datasets.has(dataset.id)) this.datasets.set(dataset.id, dataset);
  }

  get(id: string): DataTransferDataset | undefined {
    return this.datasets.get(id);
  }

  all(): DataTransferDataset[] {
    return [...this.datasets.values()];
  }
}
