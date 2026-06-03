import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  SsoAdminService,
  SsoDomain,
  SsoIdentityProvider,
} from '../../../../core/services/sso-admin.service';

/**
 * Per-organization enterprise SSO settings: manage verified email domains and OIDC identity
 * providers (Okta, Microsoft Entra, Google Workspace, Ping, Auth0, ...). A provider can only
 * be enabled once at least one domain is verified via the published DNS TXT record.
 */
@Component({
  selector: 'app-sso-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './sso.page.html',
  styleUrls: ['./sso.page.scss'],
})
export class SsoSettingsPage implements OnInit {
  private readonly api = inject(SsoAdminService);
  private readonly fb = inject(FormBuilder);

  domains = signal<SsoDomain[]>([]);
  providers = signal<SsoIdentityProvider[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  notice = signal<string | null>(null);

  // Inline editing: the id of the provider currently being edited, or 'new', or null.
  editingProviderId = signal<string | null>(null);

  domainForm: FormGroup = this.fb.group({
    domain: ['', [Validators.required]],
  });

  providerForm: FormGroup = this.fb.group({
    name: ['', [Validators.required]],
    issuerUrl: ['', [Validators.required]],
    clientId: ['', [Validators.required]],
    clientSecret: [''],
    scopes: ['openid email profile'],
    defaultRoleId: [''],
  });

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.listDomains().subscribe({
      next: (d) => this.domains.set(d),
      error: () => this.error.set('No se pudieron cargar los dominios.'),
    });
    this.api.listProviders().subscribe({
      next: (p) => {
        this.providers.set(p);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudieron cargar los proveedores.');
        this.loading.set(false);
      },
    });
  }

  // --- Domains ---

  addDomain(): void {
    if (this.domainForm.invalid) return;
    this.clearMessages();
    this.api.addDomain(this.domainForm.value.domain).subscribe({
      next: () => {
        this.domainForm.reset();
        this.notice.set('Dominio agregado. Publica el registro DNS TXT y verifícalo.');
        this.refresh();
      },
      error: (e) => this.error.set(e?.error?.message || 'No se pudo agregar el dominio.'),
    });
  }

  verifyDomain(d: SsoDomain): void {
    this.clearMessages();
    this.api.verifyDomain(d.id).subscribe({
      next: () => {
        this.notice.set(`Dominio ${d.domain} verificado.`);
        this.refresh();
      },
      error: (e) => this.error.set(e?.error?.message || 'No se pudo verificar el dominio aún.'),
    });
  }

  deleteDomain(d: SsoDomain): void {
    this.clearMessages();
    this.api.deleteDomain(d.id).subscribe({
      next: () => this.refresh(),
      error: () => this.error.set('No se pudo eliminar el dominio.'),
    });
  }

  copy(value: string): void {
    navigator.clipboard?.writeText(value).then(
      () => this.notice.set('Copiado al portapapeles.'),
      () => undefined,
    );
  }

  // --- Providers ---

  startNewProvider(): void {
    this.providerForm.reset({ scopes: 'openid email profile' });
    this.editingProviderId.set('new');
    this.clearMessages();
  }

  startEditProvider(p: SsoIdentityProvider): void {
    this.providerForm.reset({
      name: p.name,
      issuerUrl: p.issuerUrl,
      clientId: p.clientId,
      clientSecret: '', // never prefilled
      scopes: (p.scopes || []).join(' '),
      defaultRoleId: p.defaultRoleId || '',
    });
    this.editingProviderId.set(p.id);
    this.clearMessages();
  }

  cancelEdit(): void {
    this.editingProviderId.set(null);
  }

  saveProvider(): void {
    const editing = this.editingProviderId();
    if (!editing || this.providerForm.invalid) return;
    this.clearMessages();

    const raw = this.providerForm.value;
    const scopes = String(raw.scopes || '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const base: any = {
      name: raw.name,
      issuerUrl: raw.issuerUrl,
      clientId: raw.clientId,
      scopes: scopes.length ? scopes : ['openid', 'email', 'profile'],
    };
    if (raw.clientSecret) base.clientSecret = raw.clientSecret;
    if (raw.defaultRoleId) base.defaultRoleId = raw.defaultRoleId;

    if (editing === 'new') {
      if (!raw.clientSecret) {
        this.error.set('El client secret es obligatorio al crear un proveedor.');
        return;
      }
      this.api.createProvider(base).subscribe({
        next: () => {
          this.editingProviderId.set(null);
          this.notice.set('Proveedor creado. Verifica un dominio y actívalo.');
          this.refresh();
        },
        error: (e) => this.error.set(e?.error?.message || 'No se pudo crear el proveedor.'),
      });
    } else {
      this.api.updateProvider(editing, base).subscribe({
        next: () => {
          this.editingProviderId.set(null);
          this.notice.set('Proveedor actualizado.');
          this.refresh();
        },
        error: (e) => this.error.set(e?.error?.message || 'No se pudo actualizar el proveedor.'),
      });
    }
  }

  toggleEnabled(p: SsoIdentityProvider): void {
    this.clearMessages();
    this.api.updateProvider(p.id, { enabled: !p.enabled }).subscribe({
      next: () => this.refresh(),
      error: (e) => this.error.set(e?.error?.message || 'No se pudo cambiar el estado.'),
    });
  }

  deleteProvider(p: SsoIdentityProvider): void {
    this.clearMessages();
    this.api.deleteProvider(p.id).subscribe({
      next: () => this.refresh(),
      error: () => this.error.set('No se pudo eliminar el proveedor.'),
    });
  }

  hasVerifiedDomain(): boolean {
    return this.domains().some((d) => d.verified);
  }

  private clearMessages(): void {
    this.error.set(null);
    this.notice.set(null);
  }
}
