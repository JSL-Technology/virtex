import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, ChevronDown } from 'lucide-angular';

import { SIDEBAR_MENU, SidebarItem, SidebarGroup } from './sidebar-menu';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule, LucideAngularModule],
  templateUrl: './sidebar.html',
  styleUrls: ['./sidebar.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sidebar {
  public menuGroups: SidebarGroup[] = SIDEBAR_MENU;

  protected readonly ChevronDownIcon = ChevronDown;

  public toggleSubMenu(clickedItem: SidebarItem): void {
    const wasExpanded = clickedItem.isExpanded;

    this.menuGroups.forEach(group => {
      group.items.forEach(item => {
        if (item.subItems) {
          item.isExpanded = false;
        }
      });
    });

    if (!wasExpanded) {
      clickedItem.isExpanded = true;
    }
  }
}
