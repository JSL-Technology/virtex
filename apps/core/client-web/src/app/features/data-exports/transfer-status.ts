import { VxTone } from '../../shared/components/badge';
import { DataTransferStatus } from '../../core/api/data-transfer.service';

/** One mapping for both history lists, so a status reads the same on the export and import pages. */
export function transferStatusTone(status: DataTransferStatus): VxTone {
  switch (status) {
    case 'COMPLETED':
      return 'ok';
    case 'VALIDATED':
      return 'info';
    case 'PARTIAL':
      return 'warning';
    case 'FAILED':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** The catalogue key of a status (`data_transfer.status.completed`…). */
export function transferStatusKey(status: DataTransferStatus): string {
  return `data_transfer.status.${status.toLowerCase()}`;
}
