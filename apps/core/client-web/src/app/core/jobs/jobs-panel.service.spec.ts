import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { JobsPanelService, TenantJob } from './jobs-panel.service';

/**
 * Lo que hay que garantizar aquí no es que la lista llegue: es que el sondeo se detenga.
 *
 * Un panel que vuelve a preguntar cada cinco segundos para siempre multiplica el coste de cada
 * sesión abierta para cambiar un número que casi nunca cambia. Y un fallo de red no puede vaciar
 * la lista: decir «no hay trabajos» es una afirmación mucho más fuerte que «no pude preguntar».
 */
describe('JobsPanelService', () => {
  const job = (state: TenantJob['state']): TenantJob => ({
    id: state,
    queue: 'account-jobs',
    name: 'merge-accounts',
    state,
    progress: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    finishedAt: null,
    failedReason: null,
  });

  let get: jest.Mock;
  let service: JobsPanelService;

  const build = () => {
    get = jest.fn().mockReturnValue(of([]));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [JobsPanelService, { provide: HttpClient, useValue: { get } }],
    });
    return TestBed.inject(JobsPanelService);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    service = build();
  });

  afterEach(() => {
    service.stop();
    jest.useRealTimers();
  });

  it('con la cola vacía no programa ninguna consulta más', async () => {
    await service.refresh();

    jest.advanceTimersByTime(60_000);

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('mientras haya algo en marcha, vuelve a preguntar', async () => {
    get.mockReturnValue(of([job('active')]));

    await service.refresh();
    jest.advanceTimersByTime(5000);

    expect(get).toHaveBeenCalledTimes(2);
  });

  it('se detiene en cuanto el último trabajo termina', async () => {
    get.mockReturnValueOnce(of([job('active')])).mockReturnValue(of([job('completed')]));

    await service.refresh();
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();
    const tras = get.mock.calls.length;

    jest.advanceTimersByTime(60_000);

    expect(get).toHaveBeenCalledTimes(tras);
  });

  it('un fallo conserva lo último conocido en vez de vaciar la lista', async () => {
    get.mockReturnValueOnce(of([job('active')]));
    await service.refresh();
    expect(service.jobs()).toHaveLength(1);

    get.mockReturnValue(throwError(() => new Error('sin red')));
    await service.refresh();

    expect(service.jobs()).toHaveLength(1);
  });

  it('separa los que fallaron de los que siguen', async () => {
    get.mockReturnValue(of([job('active'), job('failed'), job('completed'), job('waiting')]));

    await service.refresh();

    expect(service.running().map((j) => j.state)).toEqual(['active', 'waiting']);
    expect(service.failed().map((j) => j.state)).toEqual(['failed']);
  });

  it('detener limpia el reloj y la lista', async () => {
    get.mockReturnValue(of([job('active')]));
    await service.refresh();

    service.stop();
    jest.advanceTimersByTime(60_000);

    expect(service.jobs()).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
