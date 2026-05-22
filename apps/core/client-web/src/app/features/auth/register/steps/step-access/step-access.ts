import { 
  Component, 
  Input, 
  ChangeDetectionStrategy, 
  ChangeDetectorRef,
  inject,
  OnInit,
  OnChanges,
  SimpleChanges
} from '@angular/core';
import { FormGroup, ReactiveFormsModule, FormControl } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Mail, Lock, Eye, EyeOff, Check, X } from 'lucide-angular';

@Component({
  selector: 'app-step-access',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideAngularModule],
  templateUrl: './step-access.html',
  styleUrls: ['./step-access.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StepAccess implements OnInit, OnChanges {
  @Input() parentForm!: FormGroup;
  
  // Iconos para la plantilla
  protected readonly MailIcon = Mail;
  protected readonly LockIcon = Lock;
  protected readonly EyeIcon = Eye;
  protected readonly EyeOffIcon = EyeOff;
  protected readonly CheckIcon = Check;
  protected readonly XIcon = X;
  
  // Control de visibilidad
  showPassword = false;
  showConfirmPassword = false;
  showPasswordHints = false;

  // Referencia al detector de cambios
  private cdRef = inject(ChangeDetectorRef);

  // Suscripción para cambios en la contraseña
  private passwordChangesSubscription: any;

  ngOnInit() {
    this.setupPasswordListener();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['parentForm']) {
      this.setupPasswordListener();
    }
  }

  private setupPasswordListener() {
    // Limpiar suscripción anterior si existe
    if (this.passwordChangesSubscription) {
      this.passwordChangesSubscription.unsubscribe();
    }
    
    // Obtener el control de contraseña
    const passwordControl = this.passwordGroup?.get('password');
    
    if (passwordControl) {
      // Suscribirse a cambios en el valor de la contraseña
      this.passwordChangesSubscription = passwordControl.valueChanges.subscribe(() => {
        // Forzar la detección de cambios
        this.cdRef.detectChanges();
      });
    }
  }

  // Grupo de contraseñas con manejo seguro
  get passwordGroup(): FormGroup | null {
    try {
      return this.parentForm?.get?.('passwordGroup') as FormGroup;
    } catch {
      return null;
    }
  }

  // Método seguro para obtener valor del campo de contraseña
  get passwordValue(): string {
    return this.passwordGroup?.get?.('password')?.value || '';
  }

  // Métodos para verificar requisitos de contraseña
  hasUpperCase(value: string): boolean {
    return /[A-Z]/.test(value);
  }

  hasNumber(value: string): boolean {
    return /[0-9]/.test(value);
  }

  hasSpecialChar(value: string): boolean {
    return /[!@#$%^&*(),.?":{}|<>]/.test(value);
  }

  // Manejar el evento blur para ocultar las sugerencias
  onPasswordBlur() {
    // Ocultar solo si no hay foco en el campo de confirmación
    if (!document.activeElement?.id.includes('confirmPassword')) {
      setTimeout(() => {
        this.showPasswordHints = false;
        this.cdRef.detectChanges();
      }, 200);
    }
  }
}