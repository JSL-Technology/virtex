import { Component, Input, Type, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-tab-wrapper',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="tab-wrapper-content">
      <ng-container *ngComponentOutlet="componentType; inputs: componentInputs"></ng-container>
    </div>
  `,
  styles: [`
    .tab-wrapper-content {
      height: 100%;
      width: 100%;
      overflow: auto;
    }
  `]
})
export class TabWrapperComponent implements OnInit {
  @Input() componentType!: Type<any>;
  @Input() componentInputs: any = {};

  // Dockview passes parameters via the 'params' property of the panel
  // but we are using this component as the Angular component registered in Dockview.
  // When Dockview creates the Angular component, it should inject the parameters.
  // dockview-angular typically passes 'params' to the component.

  // If dockview-angular doesn't automatically map 'params' to @Input,
  // we might need to access them differently.
  // Based on dockview-angular docs, it might be passed as a property named 'params'.
  params: any;

  ngOnInit() {
    if (this.params) {
      this.componentType = this.params.componentType;
      this.componentInputs = this.params.componentInputs || {};
    }
  }
}
