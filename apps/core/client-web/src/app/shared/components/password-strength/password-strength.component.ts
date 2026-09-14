import {
  ChangeDetectionStrategy,
  Component,
  Input,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Check, X } from 'lucide-angular';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../validators/password.validator';

/**
 * A single password rule, evaluated live as the user types.
 *
 * `labelKey` and not `label`: the checklist read "Al menos 12 caracteres" to every reader, in an
 * English interface as readily as a Spanish one. The bound travels as an interpolation parameter
 * rather than being baked into the sentence, so raising the minimum changes one constant.
 */
interface PasswordRequirement {
  readonly labelKey: string;
  readonly labelParams?: Record<string, unknown>;
  readonly test: (value: string) => boolean;
}

type StrengthLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Shared, real-time password strength indicator.
 *
 * Mirrors the backend password policy (see `strongPasswordValidator`) so the
 * checklist the user sees is the exact same contract the server enforces:
 * a single source of truth (no drift between client hint and server rule).
 *
 * Shows, in real time, a segmented strength meter plus a checklist that marks
 * each requirement as met/unmet — telling the user precisely what is missing.
 */
@Component({
  selector: 'app-password-strength',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './password-strength.component.html',
  styleUrls: ['./password-strength.component.scss'],
})
export class PasswordStrengthComponent {
  /** The password to evaluate. Bind it to the form control's value. */
  @Input()
  set password(value: string | null | undefined) {
    this._password.set(value ?? '');
  }
  get password(): string {
    return this._password();
  }
  private readonly _password = signal('');

  protected readonly CheckIcon = Check;
  protected readonly XIcon = X;

  /** The rules a password must satisfy. Order is the order shown to the user. */
  protected readonly requirements: PasswordRequirement[] = [
    {
      labelKey: 'password_strength.requirement.min_length',
      labelParams: { min: PASSWORD_MIN_LENGTH },
      test: (v) => v.length >= PASSWORD_MIN_LENGTH && v.length <= PASSWORD_MAX_LENGTH,
    },
    { labelKey: 'password_strength.requirement.uppercase', test: (v) => /[A-Z]/.test(v) },
    { labelKey: 'password_strength.requirement.lowercase', test: (v) => /[a-z]/.test(v) },
    {
      labelKey: 'password_strength.requirement.number_or_symbol',
      test: (v) => /[0-9]/.test(v) || /[^A-Za-z0-9]/.test(v),
    },
  ];

  /** Live met/unmet status for each requirement. */
  protected readonly checks = computed(() => {
    const value = this._password();
    return this.requirements.map((r) => ({
      labelKey: r.labelKey,
      labelParams: r.labelParams ?? {},
      met: r.test(value),
    }));
  });

  /** Whether the user has typed anything yet — controls visibility. */
  protected readonly hasInput = computed(() => this._password().length > 0);

  /**
   * Strength on a 0–4 scale. Driven by how many rules pass, with a small
   * bonus for comfortably-long passwords so "12 chars + all rules" reads as
   * strong while a longer one still feels rewarded.
   */
  protected readonly strength = computed<StrengthLevel>(() => {
    const value = this._password();
    if (!value) return 0;

    let score = this.requirements.reduce(
      (acc, r) => acc + (r.test(value) ? 1 : 0),
      0,
    );

    // Length bonus: long passphrases are stronger even with fewer character classes.
    if (value.length >= PASSWORD_MIN_LENGTH + 4) score += 1;

    return Math.min(4, score) as StrengthLevel;
  });

  /** The catalogue key for the current level; the template renders it. */
  protected readonly labelKey = computed(() => {
    switch (this.strength()) {
      case 1:
        return 'password_strength.weak';
      case 2:
        return 'password_strength.fair';
      case 3:
        return 'password_strength.good';
      case 4:
        return 'password_strength.strong';
      default:
        return 'password_strength.very_weak';
    }
  });

  /** CSS modifier reflecting the current strength, used for colour theming. */
  protected readonly levelClass = computed(() => `level-${this.strength()}`);
}
