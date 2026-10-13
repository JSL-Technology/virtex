import { Injectable, PipeTransform } from '@nestjs/common';
import { BadRequestError } from '../i18n/localized.exception';
import { FlowDocumentType, isFlowDocumentType } from './contracts/document-flow.contracts';

/**
 * The `:type` route parameter, refused unless it is exactly one of the known document types.
 *
 * The first version cast the raw string and looked it up in a plain object, so prototype keys such as
 * `__proto__` passed the "is this a known type?" check through the prototype chain and failed
 * further in, with a half-rendered message. A membership test against the enum's values has no
 * such back door. The value is echoed back to the client only truncated.
 */
@Injectable()
export class FlowDocumentTypePipe implements PipeTransform<unknown, FlowDocumentType> {
  transform(value: unknown): FlowDocumentType {
    if (isFlowDocumentType(value)) return value;
    throw new BadRequestError('relationship_map.unknown_document_type', {
      type: String(value ?? '').slice(0, 40),
    });
  }
}
