import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RouterModule } from '@angular/router';
import { LanguageSelector } from '../../../../shared/components/language-selector/language-selector';

/**
 * The footer shared by every public authentication screen.
 *
 * It used to own a second, divergent copy of the language switcher: `translate.use()` called
 * directly, the choice written to a `localStorage` key nothing else read, `<html lang>` left
 * behind and `LanguageService`'s signal never updated. The switcher appeared to work and was
 * forgotten on the next page load, and the stale signal then made the route guard's
 * short-circuit permanent. It now renders the one shared selector in its compact form.
 */
@Component({
  selector: 'app-auth-footer',
  standalone: true,
  imports: [TranslateModule, RouterModule, LanguageSelector],
  templateUrl: './auth-footer.component.html',
  styleUrls: ['./auth-footer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthFooterComponent {
  readonly currentYear = new Date().getFullYear();
}
