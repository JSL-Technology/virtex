import { ModuleWithProviders, NgModule } from '@angular/core';
import { TranslateDirective, TranslatePipe, provideTranslateService } from '@ngx-translate/core';

/** The root configuration `provideTranslateService` accepts (its type is not exported upstream). */
type RootTranslateConfig = NonNullable<Parameters<typeof provideTranslateService>[0]>;

/**
 * The `TranslateModule` @ngx-translate 18 removed, kept as one small module of ours.
 *
 * Version 18 ships only standalone pieces — `TranslatePipe`, `TranslateDirective` and
 * `provideTranslateService` — and the upgrade left 365 components and specs importing a module that
 * no longer exists, so neither application compiled. This keeps their `imports: [TranslateModule]`
 * and `TranslateModule.forRoot(...)` exactly as written, built from the standalone pieces, so the
 * dependency could move forward without rewriting every file that translates something.
 */
@NgModule({
  imports: [TranslatePipe, TranslateDirective],
  exports: [TranslatePipe, TranslateDirective],
})
export class TranslateModule {
  /** The root providers, as `provideTranslateService` builds them. For tests and bootstrap. */
  static forRoot(config: RootTranslateConfig = {}): ModuleWithProviders<TranslateModule> {
    return { ngModule: TranslateModule, providers: [provideTranslateService(config)] };
  }

  /** Feature modules need no providers of their own: the service is a root singleton. */
  static forChild(): ModuleWithProviders<TranslateModule> {
    return { ngModule: TranslateModule, providers: [] };
  }
}
