import { NgModule, Optional, SkipSelf } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LoggerService } from './services/logger.service';

@NgModule({
  imports: [CommonModule],
  providers: [LoggerService]
})
export class CoreModule {
  constructor(@Optional() @SkipSelf() parentModule: CoreModule | null) {
    if (parentModule) {
      throw new Error('CoreModule must be imported only in AppModule.');
    }
  }
}
