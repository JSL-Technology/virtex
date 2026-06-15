import {
  ChangeDetectionStrategy,
  Component,
  Input,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Check, X } from 'lucide-angular';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../validators/password.validator';

/** A single password rule, evaluated live as the user types. */
interface PasswordRequirement {
  readonly label: string;
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
  imports: [CommonModule, LucideAngularModule],
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
      label: `Al menos ${PASSWORD_MIN_LENGTH} caracteres`,
      test: (v) => v.length >= PASSWORD_MIN_LENGTH && v.length <= PASSWORD_MAX_LENGTH,
    },
    { label: 'Una letra mayúscula (A-Z)', test: (v) => /[A-Z]/.test(v) },
    { label: 'Una letra minúscula (a-z)', test: (v) => /[a-z]/.test(v) },
    {
      label: 'Un número o símbolo (0-9 !@#…)',
      test: (v) => /[0-9]/.test(v) || /[^A-Za-z0-9]/.test(v),
    },
  ];

  /** Live met/unmet status for each requirement. */
  protected readonly checks = computed(() => {
    const value = this._password();
    return this.requirements.map((r) => ({
      label: r.label,
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

  protected readonly label = computed(() => {
    switch (this.strength()) {
      case 1:
        return 'Débil';
      case 2:
        return 'Aceptable';
      case 3:
        return 'Buena';
      case 4:
        return 'Fuerte';
      default:
        return '';
    }
  });

  /** CSS modifier reflecting the current strength, used for colour theming. */
  protected readonly levelClass = computed(() => `level-${this.strength()}`);
}
