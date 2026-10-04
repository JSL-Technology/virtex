import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

/** The roles the platform seeds for every tenant, by stored name. */
export const SYSTEM_ROLE_NAMES = ['ADMINISTRATOR', 'ACCOUNTANT', 'SELLER', 'MEMBER'] as const;

/**
 * A role's name in the reader's language: the platform's own roles are stored by an identifier
 * (`ADMINISTRATOR`, `SELLER`) and read as «Administrador», «Vendedor»; a role a tenant created
 * is shown as its author named it (QA M-17: «ADMINISTRATOR» under the user's name, in the roles
 * list and in every role picker).
 */
export function roleLabel(translate: TranslateService, name: string | null | undefined): string {
  if (!name) return translate.instant('user.role.no_role');
  const upper = name.toUpperCase();
  if ((SYSTEM_ROLE_NAMES as readonly string[]).includes(upper)) {
    return translate.instant(`user.role.${upper.toLowerCase()}`);
  }
  return name;
}

@Pipe({ name: 'vxRoleName', standalone: true, pure: false })
export class RoleNamePipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(role: { name?: string | null } | string | null | undefined): string {
    return roleLabel(this.translate, typeof role === 'string' ? role : role?.name);
  }
}
