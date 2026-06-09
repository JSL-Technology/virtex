import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RepositoryPage } from './repository.page';

describe('Repository', () => {
  let component: RepositoryPage;
  let fixture: ComponentFixture<RepositoryPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RepositoryPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RepositoryPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
