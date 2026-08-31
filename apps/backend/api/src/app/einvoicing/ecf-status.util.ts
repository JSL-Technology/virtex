import { EcfStatus } from './entities/ecf-submission.entity';

/**
 * Maps a DGII "estado" string (from reception or status polling) to our lifecycle status.
 * Unknown/processing verdicts stay as SENT so the reconciler keeps polling.
 */
export function mapDgiiEstado(estado: string | undefined | null): EcfStatus {
  const normalized = (estado || '').toLowerCase().replace(/\s+/g, '');
  switch (normalized) {
    case 'aceptado':
      return EcfStatus.ACCEPTED;
    case 'aceptadocondicional':
      return EcfStatus.ACCEPTED_WITH_OBSERVATIONS;
    case 'rechazado':
      return EcfStatus.REJECTED;
    case 'enproceso':
    case 'recibido':
      return EcfStatus.SENT;
    default:
      return EcfStatus.SENT;
  }
}

/** True once the DGII has issued a terminal verdict (no more polling needed). */
export function isTerminalStatus(status: EcfStatus): boolean {
  return (
    status === EcfStatus.ACCEPTED ||
    status === EcfStatus.ACCEPTED_WITH_OBSERVATIONS ||
    status === EcfStatus.REJECTED
  );
}
