import { GUARDS_METADATA } from '@nestjs/common/constants';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PERMISSIONS_KEY } from '../../decorators/permissions.constants';
import { PermissionsGuard } from './permissions.guard';
import { HasPermission } from '../../decorators/permissions.decorator';
import { CheckPermissions } from '../../decorators/check-permissions.decorator';

/**
 * A declared permission must be an ENFORCED permission.
 *
 * Eight controllers declared `@HasPermission(...)` and never registered `PermissionsGuard`, which
 * is not a global guard. Nest therefore stored the requirement as metadata that nothing read, and
 * those routes answered every authenticated member of the tenant — among them accounting period
 * close and reopen, the inflation adjustment, consolidation, journal-entry adjustments, invoice
 * creation, financial and analytical reporting, and workflow management.
 *
 * The decorator now applies the guard itself, so the two cannot come apart. These tests assert
 * that property directly, and then sweep the source tree so a future decorator that forgets it —
 * or a controller that hand-rolls `SetMetadata(PERMISSIONS_KEY, …)` — fails here rather than in
 * production.
 */
describe('permission declarations are enforced', () => {
  describe('the decorators carry their guard', () => {
    it('@HasPermission applies PermissionsGuard', () => {
      class Target {
        @HasPermission('users:view')
        handler() {
          return null;
        }
      }
      const guards = Reflect.getMetadata(GUARDS_METADATA, Target.prototype.handler) ?? [];
      expect(guards).toContain(PermissionsGuard);
    });

    it('@HasPermission still records the requirement', () => {
      class Target {
        @HasPermission('users:view')
        handler() {
          return null;
        }
      }
      expect(Reflect.getMetadata(PERMISSIONS_KEY, Target.prototype.handler)).toEqual(['users:view']);
    });

    it('@CheckPermissions is the same decorator under its historical name', () => {
      expect(CheckPermissions).toBe(HasPermission);
    });

    it('applies the guard at class level too', () => {
      @HasPermission('users:view')
      class Target {}
      const guards = Reflect.getMetadata(GUARDS_METADATA, Target) ?? [];
      expect(guards).toContain(PermissionsGuard);
    });
  });

  describe('no controller declares a permission the guard cannot see', () => {
    const APP_ROOT = join(__dirname, '..', '..', '..');

    const controllerFiles = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return controllerFiles(full);
        return full.endsWith('.controller.ts') ? [full] : [];
      });

    it('finds controllers to check (guards against a silently empty sweep)', () => {
      expect(controllerFiles(APP_ROOT).length).toBeGreaterThan(20);
    });

    it.each(controllerFiles(APP_ROOT).map((f) => [f.slice(APP_ROOT.length + 1), f]))(
      '%s',
      (_label, file) => {
        const source = readFileSync(file as string, 'utf8');

        // Raw SetMetadata on the permissions key bypasses the decorators entirely, so the guard
        // would never be attached. There is no legitimate reason for a controller to do this.
        expect(source).not.toMatch(
          new RegExp(`SetMetadata\\(\\s*${PERMISSIONS_KEY}\\b`),
        );
        expect(source).not.toMatch(/SetMetadata\(\s*['"]permissions['"]/);

        // Any permission requirement must come from a decorator that carries the guard.
        const declaresPermission = /@(HasPermission|CheckPermissions)\s*\(/.test(source);
        if (declaresPermission) {
          expect(source).toMatch(
            /import\s*\{[^}]*\b(HasPermission|CheckPermissions)\b[^}]*\}\s*from\s*['"][^'"]*(permissions|check-permissions)\.decorator['"]/,
          );
        }
      },
    );
  });
});
