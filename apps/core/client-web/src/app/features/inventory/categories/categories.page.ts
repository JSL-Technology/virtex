import { Component } from '@angular/core';
// import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { ListShellComponent } from '../../../shared/components/gestures';
@Component({
  selector: 'app-categories-page', standalone: true,
  imports: [LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './categories.page.html', styleUrls: ['./categories.page.scss']
})
export class CategoriesPage {
  protected readonly PlusCircleIcon = PlusCircle;
}