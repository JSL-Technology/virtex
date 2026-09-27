import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpHandlerFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { ViewContainerRef } from '@angular/core';
import { EMPTY, Observable, firstValueFrom, of, throwError } from 'rxjs';
import { stepUpInterceptor, STEP_UP_RETRIED } from './step-up.interceptor';
import { StepUpScope, StepUpService, stepUpScopeOf } from '../services/step-up.service';

/**
 * Payroll approval and payslips were guarded by step-up on the server and never prompted for in
 * the browser: the screen got a 401 it could do nothing about. The server now names the scope in
 * the challenge, and this answers it wherever it comes from.
 */
describe('stepUpInterceptor', () => {
  const challenge = (scope: string = StepUpScope.APPROVE_PAYROLL) =>
    new HttpErrorResponse({
      status: 401,
      error: { messageKey: 'auth.step_up_authentication_required', params: { scope } },
    });

  let requireStepUp: jest.Mock;

  const run = (
    next: HttpHandlerFn,
    req = new HttpRequest('POST', '/api/v1/payroll/runs/1/approve', {}),
    host: unknown = {} as ViewContainerRef,
  ) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: StepUpService, useValue: { requireStepUp, defaultHost: host } }],
    });
    return TestBed.runInInjectionContext(() =>
      firstValueFrom(stepUpInterceptor(req, next)).catch((e) => e),
    );
  };

  beforeEach(() => {
    requireStepUp = jest.fn((_scope, _host, action: () => Observable<unknown>) => action());
  });

  it('asks for exactly the scope the server named, then repeats the request once', async () => {
    const ok = new HttpResponse({ status: 200, body: { approved: true } });
    const next = jest
      .fn<Observable<unknown>, [HttpRequest<unknown>]>()
      .mockReturnValueOnce(throwError(() => challenge()))
      .mockReturnValueOnce(of(ok));

    const result = await run(next as unknown as HttpHandlerFn);

    expect(requireStepUp).toHaveBeenCalledWith(StepUpScope.APPROVE_PAYROLL, expect.anything(), expect.any(Function));
    expect(result).toBe(ok);
    expect(next).toHaveBeenCalledTimes(2);
    expect(next.mock.calls[1][0].context.get(STEP_UP_RETRIED)).toBe(true);
  });

  it('hands the caller the original error when the user cancels the prompt', async () => {
    requireStepUp.mockReturnValue(EMPTY);
    const error = challenge();
    const result = await run(() => throwError(() => error));
    expect(result).toBe(error);
  });

  it('never prompts twice for the same request', async () => {
    const error = challenge();
    const req = new HttpRequest('POST', '/x', {}).clone({
      context: new HttpRequest('POST', '/x', {}).context.set(STEP_UP_RETRIED, true),
    });
    const result = await run(() => throwError(() => error), req);
    expect(result).toBe(error);
    expect(requireStepUp).not.toHaveBeenCalled();
  });

  it('leaves other 401s to the auth layer', async () => {
    const expired = new HttpErrorResponse({ status: 401, error: { messageKey: 'auth.session_expired' } });
    const result = await run(() => throwError(() => expired));
    expect(result).toBe(expired);
    expect(requireStepUp).not.toHaveBeenCalled();
  });

  it('does not answer a scope the client does not know', () => {
    expect(stepUpScopeOf(challenge('something_new'))).toBeNull();
    expect(stepUpScopeOf(challenge(StepUpScope.MOVE_FUNDS))).toBe(StepUpScope.MOVE_FUNDS);
  });
});
