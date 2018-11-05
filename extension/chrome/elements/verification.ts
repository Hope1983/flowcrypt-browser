/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Store } from '../../js/common/store.js';
import { Xss, Ui, Env } from '../../js/common/browser.js';
import { FcAcct } from './../../js/common/account.js';
import { Catch } from '../../js/common/catch.js';

Catch.try(async () => {

  Ui.event.protect();

  let urlParams = Env.urlParams(['acctEmail', 'verificationEmailText', 'parentTabId', 'subscribeResultTabId']);
  let acctEmail = Env.urlParamRequire.string(urlParams, 'acctEmail');
  let parentTabId = Env.urlParamRequire.string(urlParams, 'parentTabId');

  let fcAcct = new FcAcct({}, true);
  let token = fcAcct.parseTokenEmailText(urlParams.verificationEmailText as string);

  let renderStatus = (content: string, spinner = false) => {
    Xss.sanitizeRender('body .status', Xss.htmlSanitize(content + (spinner ? ' ' + Ui.spinner('white') : '')));
  };

  if (!token) {
    renderStatus('This verification email seems to have wrong format. Email human@flowcrypt.com to get this resolved.');
  } else {
    try {
      let { cryptup_subscription_attempt } = await Store.getGlobal(['cryptup_subscription_attempt']);
      let response = await fcAcct.verify(acctEmail, [token]);
      if (cryptup_subscription_attempt) {
        let subscription = await fcAcct.subscribe(acctEmail, cryptup_subscription_attempt, cryptup_subscription_attempt.source);
        if (subscription && subscription.level === 'pro') {
          renderStatus('Welcome to FlowCrypt Advanced.');
        } else {
          renderStatus('Email verified, but had trouble enabling FlowCrypt Advanced. Email human@flowcrypt.com to get this resolved.');
        }
      } else {
        renderStatus('Email verified, no further action needed.');
      }
    } catch (error) {
      renderStatus('Could not complete: ' + error.message);
      Catch.log('problem in verification.js', error);
    }
  }

})();