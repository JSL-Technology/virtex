import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { trigger, style, animate, transition, query, animateChild, group } from '@angular/animations';
import { LucideAngularModule, X } from 'lucide-angular';

@Component({
  selector: 'app-ui-modal',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './ui-modal.component.html',
  styleUrls: ['./ui-modal.component.scss'],
  animations: [
    trigger('modalContainer', [
      transition(':enter', [
        group([
          query('@modalBackdrop', animateChild()),
          query('@modalPanel', animateChild()),
        ])
      ]),
      transition(':leave', [
        group([
          query('@modalBackdrop', animateChild()),
          query('@modalPanel', animateChild()),
        ])
      ])
    ]),
    trigger('modalBackdrop', [
      transition(':enter', [
        style({ opacity: 0 }),
        animate('300ms ease-out', style({ opacity: 1 }))
      ]),
      transition(':leave', [
        animate('200ms ease-in', style({ opacity: 0 }))
      ])
    ]),
    trigger('modalPanel', [
      transition(':enter', [
        style({ opacity: 0, transform: 'scale(0.95)' }),
        animate('300ms cubic-bezier(0.16, 1, 0.3, 1)', style({ opacity: 1, transform: 'scale(1)' }))
      ]),
      transition(':leave', [
        animate('200ms cubic-bezier(0.16, 1, 0.3, 1)', style({ opacity: 0, transform: 'scale(0.95)' }))
      ])
    ])
  ]
})
export class UiModalComponent {
  /**
   * Controls the visibility of the modal.
   * Note: The parent component should conditionally render this component or bind to this input.
   * If using @if(isOpen) in parent, this input is less relevant for animation entry,
   * but useful for internal logic or if not using @if.
   * However, for the animations to trigger on :enter/:leave, the *ngIf or @if in the parent is key.
   * This component structure assumes it is always present in DOM when 'isOpen' is true,
   * or the parent handles the DOM insertion/removal.
   */
  @Input() isOpen = false;

  /** Title of the modal displayed in the header */
  @Input() title: string = '';

  /** Size of the modal: 'sm' | 'md' | 'lg' | 'xl' | 'full' */
  @Input() size: 'sm' | 'md' | 'lg' | 'xl' | 'full' = 'md';

  /** Whether to show the close button in the header */
  @Input() hideCloseButton = false;

  /** Whether clicking the backdrop closes the modal */
  @Input() closeOnBackdropClick = true;

  @Output() close = new EventEmitter<void>();

  readonly XIcon = X;

  @HostListener('document:keydown.escape')
  onEscape() {
    this.closeModal();
  }

  onBackdropClick() {
    if (this.closeOnBackdropClick) {
      this.closeModal();
    }
  }

  closeModal() {
    this.close.emit();
  }
}
