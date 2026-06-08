
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Plus, FileSpreadsheet, Clock, Users, Star, Trash2, MoreVertical } from 'lucide-angular';

@Component({
  selector: 'app-datasheet-list',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule, LucideAngularModule],
  styleUrl: './datasheet-list.page.scss',
  template: `
    <div class="datasheet-list-container">
      <div class="header">
        <div class="title-section">
          <h1>{{ 'datasheets.title' | translate }}</h1>
          <p>{{ 'datasheets.subtitle' | translate }}</p>
        </div>
        <button [routerLink]="['new']" class="btn-new">
          <lucide-icon [img]="PlusIcon" [size]="20"></lucide-icon>
          {{ 'datasheets.new_document' | translate }}
        </button>
      </div>

      <div class="content-grid">
        <div class="sidebar">
          <button class="nav-item active">
            <lucide-icon [img]="ClockIcon" [size]="18"></lucide-icon>
            {{ 'datasheets.recent' | translate }}
          </button>
          <button class="nav-item">
            <lucide-icon [img]="FileIcon" [size]="18"></lucide-icon>
            {{ 'datasheets.my_documents' | translate }}
          </button>
          <button class="nav-item">
            <lucide-icon [img]="UsersIcon" [size]="18"></lucide-icon>
            {{ 'datasheets.shared' | translate }}
          </button>
          <button class="nav-item">
            <lucide-icon [img]="StarIcon" [size]="18"></lucide-icon>
            {{ 'datasheets.templates' | translate }}
          </button>
          <button class="nav-item">
            <lucide-icon [img]="TrashIcon" [size]="18"></lucide-icon>
            {{ 'datasheets.trash' | translate }}
          </button>
        </div>

        <div class="main-content">
          <div class="table-container">
            <table class="documents-table">
              <thead>
                <tr>
                  <th>{{ 'datasheets.name' | translate }}</th>
                  <th>{{ 'datasheets.owner' | translate }}</th>
                  <th>{{ 'datasheets.last_modified' | translate }}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let doc of documents" [routerLink]="[doc.id]">
                  <td class="name-cell">
                    <div class="doc-info">
                      <div class="icon-box">
                        <lucide-icon [img]="FileIcon" [size]="20"></lucide-icon>
                      </div>
                      <span class="doc-name">{{ doc.name }}</span>
                    </div>
                  </td>
                  <td>{{ doc.owner }}</td>
                  <td>{{ doc.modifiedAt | date:'medium' }}</td>
                  <td class="actions-cell">
                    <button class="btn-more">
                      <lucide-icon [img]="MoreVerticalIcon" [size]="18"></lucide-icon>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `
})
export class DatasheetListPage {
  PlusIcon = Plus;
  FileIcon = FileSpreadsheet;
  ClockIcon = Clock;
  UsersIcon = Users;
  StarIcon = Star;
  TrashIcon = Trash2;
  MoreVerticalIcon = MoreVertical;

  documents = [
    { id: '1', name: 'Estado de Resultados Q1', owner: 'Juan Pérez', modifiedAt: new Date() },
    { id: '2', name: 'Análisis de Rentabilidad - Laptops', owner: 'Ana García', modifiedAt: new Date() },
  ];
}
