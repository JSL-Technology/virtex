import { SaasErrorCode, SaasLimitReachedException, SaasNoPlanException } from './saas-exception';
import { SaasResource } from '../enums/saas-resource.enum';
import { isLocalizedError } from '../../i18n/localized.exception';
import { I18nService } from '../../i18n/i18n.service';

/** A plan limit read «You do not have permission to perform this action»: wrong reason, no way out. */
describe('SaaS refusals', () => {
  it('a plan limit names the resource in the reader’s language and keeps its remedy code', () => {
    const error = new SaasLimitReachedException(SaasResource.INVOICES);
    expect(isLocalizedError(error)).toBe(true);
    expect(error.code).toBe(SaasErrorCode.LIMIT_REACHED);

    const i18n = new I18nService();
    const text = i18n.translate(error.messageKey, 'es', error.params);
    expect(text).toContain('facturas');
    expect(text).not.toContain('saas.');
  });

  it('a missing plan is localized too', () => {
    const error = new SaasNoPlanException('org-1');
    expect(isLocalizedError(error)).toBe(true);
    expect(error.messageKey).toBe('saas.no_active_plan');
  });
});
