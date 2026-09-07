import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { ListShellComponent } from '../../../shared/components/gestures';

interface Branch {
  id: string;
  name: string;
  address: string;
  city: string;
  phone: string;
}

@Component({
  selector: 'app-branches-page',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './branches.page.html',
  styleUrls: ['./branches.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchesPage {
  protected readonly PlusCircleIcon = PlusCircle;

  branches = signal<Branch[]>([
    { id: 'br-01', name: 'Oficina Principal', address: 'Av. Winston Churchill 1515', city: 'Santo Domingo', phone: '809-555-0101' },
    { id: 'br-02', name: 'Sucursal Santiago', address: 'Av. Juan Pablo Duarte 212', city: 'Santiago', phone: '829-555-0202' },
  ]);
}