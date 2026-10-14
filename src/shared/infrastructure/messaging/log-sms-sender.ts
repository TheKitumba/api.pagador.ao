import { Injectable, Logger } from '@nestjs/common';

import { SmsSender } from '../../application/ports';

/** Development SMS adapter: logs the message. Replace with an Unitel/Africell/Movicel gateway adapter. */
@Injectable()
export class LogSmsSender extends SmsSender {
  private readonly logger = new Logger('SMS');

  async send(phone: string, text: string) {
    this.logger.log(`[sms] ${phone}: ${text}`);
  }
}
