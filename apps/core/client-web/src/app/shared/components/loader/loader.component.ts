import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-loader',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="loader-overlay" [ngClass]="{'fixed-overlay': overlay, 'absolute-overlay': !overlay}">
      <div class="spinner"></div>
    </div>
  `,
  styleUrls: ['./loader.component.scss']
})
export class LoaderComponent {
  @Input() overlay = true;
}
