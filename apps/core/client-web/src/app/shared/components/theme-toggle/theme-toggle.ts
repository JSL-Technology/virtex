import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule, Moon, Sun } from 'lucide-angular';

import { ThemeService } from '../../../core/services/theme';
import { TranslateModule } from '@ngx-translate/core';

/** A single, explicit control for switching between light and dark themes. */
@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule],
  templateUrl: './theme-toggle.html',
  styleUrls: ['./theme-toggle.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);
  protected readonly SunIcon = Sun;
  protected readonly MoonIcon = Moon;

  protected toggle(): void {
    this.theme.setMode(this.theme.isDark() ? 'light' : 'dark');
  }
}
