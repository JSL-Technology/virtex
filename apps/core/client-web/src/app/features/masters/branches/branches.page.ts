import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal } from 'lucide-angular';

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
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './branches.page.html',
  styleUrls: ['./branches.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BranchesPage {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;

  branches = signal<Branch[]>([
    { id: 'br-01', name: 'Oficina Principal', address: 'Av. Winston Churchill 1515', city: 'Santo Domingo', phone: '809-555-0101' },
    { id: 'br-02', name: 'Sucursal Santiago', address: 'Av. Juan Pablo Duarte 212', city: 'Santiago', phone: '829-555-0202' },
  ]);
}