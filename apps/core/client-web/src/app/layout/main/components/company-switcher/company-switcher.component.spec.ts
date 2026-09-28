import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { signal } from '@angular/core';

import { CompanySwitcherComponent } from './company-switcher.component';
import { AuthService } from '../../../../core/services/auth';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { of } from 'rxjs';
import { OrganizationInvitationsService } from '../../../../core/services/organization-invitations.service';

/**
 * Cambiar de empresa tuvo dos vidas anteriores, y esta prueba fija que no vuelva a ninguna.
 *
 * La primera terminaba en `// In a real app, this would call a service to switch organization.`:
 * cerraba todas las pestañas y dejaba al usuario en la empresa de la que partía. La segunda
 * emitía tokens nuevos y recargaba la página, lo que costaba el espacio de trabajo completo.
 *
 * Ahora es una navegación, y lo que hay que garantizar es eso: que navega a la misma página en la
 * otra empresa, que no toca las pestañas y que un fallo se ve.
 */
describe('CompanySwitcherComponent', () => {
  const ORG_A = { id: 'org-a', legalName: 'Cliente A', slug: 'cliente-a' };
  const ORG_B = { id: 'org-b', legalName: 'Cliente B', slug: 'cliente-b' };

  let fixture: ComponentFixture<CompanySwitcherComponent>;
  let component: CompanySwitcherComponent;
  let navigateByUrl: jest.Mock;
  let remember: jest.Mock;
  const activeSlug = signal<string | null>('cliente-a');
  const received = signal<Array<Record<string, unknown>>>([]);
  let invitations: { received: typeof received; refresh: jest.Mock; accept: jest.Mock; decline: jest.Mock };
  let reloadSession: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    activeSlug.set('cliente-a');
    navigateByUrl = jest.fn().mockResolvedValue(true);
    remember = jest.fn();
    received.set([]);
    reloadSession = jest.fn(() => of(true));
    invitations = {
      received,
      refresh: jest.fn(() => of([])),
      accept: jest.fn(() => of({ messageKey: 'users.invitation_accepted', organizationId: 'org-c' })),
      decline: jest.fn(() => of({ messageKey: 'users.invitation_declined' })),
    };

    await TestBed.configureTestingModule({
      imports: [CompanySwitcherComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: AuthService,
          useValue: {
            currentUser: () => ({ organization: ORG_A, organizations: [ORG_A, ORG_B] }),
            reloadSession,
          },
        },
        { provide: OrganizationInvitationsService, useValue: invitations },
        {
          provide: ActiveOrganizationService,
          useValue: {
            slug: activeSlug,
            organization: () => (activeSlug() === 'cliente-a' ? ORG_A : ORG_B),
            urlInOrganization: (slug: string) => `/e/${slug}/invoices`,
            remember,
          },
        },
        { provide: Router, useValue: { navigateByUrl } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CompanySwitcherComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('lista las empresas reales del usuario', () => {
    expect(component.filteredOrganizations().map((o) => o.slug)).toEqual([
      'cliente-a',
      'cliente-b',
    ]);
  });

  it('la empresa mostrada es la de la URL, no la del token', () => {
    activeSlug.set('cliente-b');
    expect(component.currentOrg()?.id).toBe('org-b');
  });

  it('cambiar de empresa navega a la misma página en la otra', async () => {
    component.selectOrganization(ORG_B);
    await Promise.resolve();

    expect(navigateByUrl).toHaveBeenCalledWith('/e/cliente-b/invoices');
  });

  it('recuerda la empresa elegida para la próxima sesión', async () => {
    component.selectOrganization(ORG_B);
    await Promise.resolve();

    expect(remember).toHaveBeenCalledWith('cliente-b');
  });

  it('elegir la empresa en la que ya estás no navega', () => {
    component.selectOrganization(ORG_A);

    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('una navegación rechazada por un guard se dice, no se calla', async () => {
    navigateByUrl.mockResolvedValue(false);

    component.selectOrganization(ORG_B);
    await Promise.resolve();
    await Promise.resolve();

    expect(component.switchError()).not.toBeNull();
    expect(component.switching()).toBe(false);
  });

  it('un fallo de navegación deja de girar y se dice', async () => {
    navigateByUrl.mockRejectedValue(new Error('boom'));

    component.selectOrganization(ORG_B);
    await Promise.resolve();
    await Promise.resolve();

    expect(component.switchError()).not.toBeNull();
    expect(component.switching()).toBe(false);
  });

  it('el menú no se cierra mientras el cambio está en vuelo', () => {
    let resolver: (v: boolean) => void = () => undefined;
    navigateByUrl.mockReturnValue(new Promise<boolean>((r) => (resolver = r)));

    component.toggleDropdown();
    component.selectOrganization(ORG_B);
    component.closeDropdown();

    expect(component.isOpen()).toBe(true);
    resolver(true);
  });

  /**
   * Otra empresa ya no puede añadir esta cuenta a sí misma: solo puede PEDIRLO. La petición espera
   * aquí, y solo la propia persona decide.
   */
  describe('invitaciones pendientes', () => {
    const INVITATION = { id: 'inv-1', organizationId: 'org-c', organizationName: 'Cliente C', roleName: 'Lector' };

    it('las pide al servidor al iniciarse', () => {
      expect(invitations.refresh).toHaveBeenCalled();
    });

    it('aceptar llama al servidor y vuelve a leer la sesión: la lista de empresas nunca se edita en el cliente', () => {
      received.set([INVITATION]);
      component.acceptInvitation(INVITATION as never, new Event('click'));
      expect(invitations.accept).toHaveBeenCalledWith('inv-1');
      expect(reloadSession).toHaveBeenCalled();
      expect(component.answering()).toBeNull();
    });

    it('rechazar no concede nada ni relee la sesión', () => {
      received.set([INVITATION]);
      component.declineInvitation(INVITATION as never, new Event('click'));
      expect(invitations.decline).toHaveBeenCalledWith('inv-1');
      expect(reloadSession).not.toHaveBeenCalled();
    });
  });
});
