import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

// Import the menu structure
import { SIDEBAR_MENU, SidebarItem, SidebarGroup } from './sidebar-menu';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule],
  templateUrl: './sidebar.html',
  styleUrls: ['./sidebar.scss'],
})
export class Sidebar {
  // Make the menu available to the template
  public menuGroups: SidebarGroup[] = SIDEBAR_MENU;

  constructor() {}

  /**
   * Toggles the expanded state of a sidebar item.
   * If the item is already open, it closes it.
   * If another item is open, it closes that one before opening the new one.
   * @param clickedItem The sidebar item that was clicked.
   */
  public toggleSubMenu(clickedItem: SidebarItem): void {
    const wasExpanded = clickedItem.isExpanded;

    // Close all other submenus
    this.menuGroups.forEach(group => {
      group.items.forEach(item => {
        if (item.subItems) {
          item.isExpanded = false;
        }
      });
    });

    // If the clicked item wasn't the one already open, open it
    if (!wasExpanded) {
      clickedItem.isExpanded = true;
    }
  }
}