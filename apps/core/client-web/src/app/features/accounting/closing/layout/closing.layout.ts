import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
@Component({
  selector: 'app-closing-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslateModule],
  templateUrl: './closing.layout.html',
  styleUrls: ['./closing.layout.scss']
})
export class ClosingLayout {}