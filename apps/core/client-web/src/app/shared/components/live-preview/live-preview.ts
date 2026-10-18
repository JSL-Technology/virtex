import { Component } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-live-preview',
  standalone: true,
  imports: [LucideAngularModule, TranslatePipe],
  templateUrl: './live-preview.html',
  styleUrls: ['./live-preview.scss']
})
export class LivePreview { }