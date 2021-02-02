/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

import { PaymentMethod, SubscriptionInfo, SubscriptionLevel } from './api/account-servers/flowcrypt-com-api';

export class Subscription implements SubscriptionInfo {

  public active?: boolean;
  public method?: PaymentMethod;
  public level?: SubscriptionLevel;
  public expire?: string;
  public expired?: boolean;

  constructor(storedSubscriptionInfo: SubscriptionInfo | undefined | null) {
    if (storedSubscriptionInfo) {
      if (storedSubscriptionInfo.level && !storedSubscriptionInfo.expire) {
        this.active = true; // never expires
      } else {
        this.active = storedSubscriptionInfo.active || undefined;
      }
      this.method = storedSubscriptionInfo.method || undefined;
      this.level = storedSubscriptionInfo.level;
      this.expire = storedSubscriptionInfo.expire || undefined;
      this.expired = storedSubscriptionInfo.expired || undefined;
    }
  }

}
