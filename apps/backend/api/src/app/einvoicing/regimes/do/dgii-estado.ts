import { FiscalSubmissionStatus } from '../../entities/fiscal-submission.entity';
import { FiscalTransmissionResult } from '../fiscal-regime.types';

/**
 * The DGII's `estado`, as the product's own vocabulary.
 *
 * The authority answers in its own words — `Aceptado`, `Aceptado Condicional`, `Rechazado`,
 * `EnProceso`, `Recibido` — on reception, on a status poll and on a lifecycle message alike. This
 * is the one place that reads them, so a spelling the DGII adds (or a space it moves) is a change
 * in one function rather than in three services.
 *
 * Anything not recognised stays unresolved rather than being guessed at: a verdict invented here
 * would mark a document accepted that the DGII never accepted.
 */
export function dgiiVerdict(estado: string | null | undefined): FiscalTransmissionResult['status'] {
  switch ((estado || '').toLowerCase().replace(/\s+/g, '')) {
    case 'aceptado':
      return 'ACCEPTED';
    case 'aceptadocondicional':
      return 'ACCEPTED_WITH_OBSERVATIONS';
    case 'rechazado':
      return 'REJECTED';
    default:
      return 'PENDING';
  }
}

/**
 * The same verdict as the state of something already transmitted: `PENDING` means the DGII holds it
 * and has not decided, which is `SENT`.
 */
export function dgiiStatus(estado: string | null | undefined): FiscalSubmissionStatus {
  switch (dgiiVerdict(estado)) {
    case 'ACCEPTED':
      return FiscalSubmissionStatus.ACCEPTED;
    case 'ACCEPTED_WITH_OBSERVATIONS':
      return FiscalSubmissionStatus.ACCEPTED_WITH_OBSERVATIONS;
    case 'REJECTED':
      return FiscalSubmissionStatus.REJECTED;
    default:
      return FiscalSubmissionStatus.SENT;
  }
}

/** True once the authority has given a verdict there is no point asking about again. */
export function isTerminalStatus(status: FiscalSubmissionStatus): boolean {
  return (
    status === FiscalSubmissionStatus.ACCEPTED ||
    status === FiscalSubmissionStatus.ACCEPTED_WITH_OBSERVATIONS ||
    status === FiscalSubmissionStatus.REJECTED
  );
}
