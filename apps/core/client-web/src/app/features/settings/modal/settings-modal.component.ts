import { Component, HostListener, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { LucideAngularModule, X } from 'lucide-angular';

@Component({
  selector: 'app-settings-modal',
  standalone: true,
  imports: [RouterOutlet, LucideAngularModule],
  templateUrl: './settings-modal.component.html',
  styleUrls: ['./settings-modal.component.scss'],
})
export class SettingsModalComponent {
  private router = inject(Router);

  protected readonly XIcon = X;

  close(): void {
    this.router.navigate([{ outlets: { modal: null } }]);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }
}
