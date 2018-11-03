/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Store, Subscription, Serializable } from '../../js/common/store.js';
import { Catch, Env, Dict } from './../../js/common/common.js';
import { Att } from '../../js/common/att.js';
import { Xss, Ui } from '../../js/common/browser.js';

import { Composer } from './../../js/common/composer.js';
import { Api, FlatHeaders } from '../../js/common/api.js';
import { BrowserMsg } from '../../js/common/extension.js';

Catch.try(async () => {

  Ui.event.protect();

  const url_params = Env.urlParams(['account_email', 'from', 'to', 'subject', 'frame_id', 'thread_id', 'thread_message_id', 'parent_tab_id', 'skip_click_prompt', 'ignore_draft']);
  let account_email = Env.url_param_require.string(url_params, 'account_email');
  let parent_tab_id = Env.url_param_require.string(url_params, 'parent_tab_id');

  let [primary_k] = await Store.keysGet(account_email, ['primary']);

  const att = Att.methods.keyinfo_as_pubkey_att(primary_k);
  let additional_msg_headers: FlatHeaders;

  let app_functions = Composer.default_app_functions();
  app_functions.send_msg_to_main_window = (channel: string, data: Dict<Serializable>) => BrowserMsg.send(parent_tab_id, channel, data);
  let composer = new Composer(app_functions, {is_reply_box: true, frame_id: url_params.frame_id, disable_draft_saving: true}, new Subscription(null));

  const send_button_text = 'Send Response';

  for (let to of (url_params.to as string).split(',')) {
    Xss.sanitize_append('.recipients', Ui.e('span', {text: to}));
  }

  // render
  $('.pubkey_file_name').text(att.name);
  composer.resize_reply_box();
  BrowserMsg.send(parent_tab_id, 'scroll_to_bottom_of_conversation');
  $('#input_text').focus();

  // determine reply headers
  try {
    let thread = await Api.gmail.threadGet(account_email, url_params.thread_id as string, 'full');
    if (thread.messages && thread.messages.length > 0) {
      let thread_msg_id_last = Api.gmail.findHeader(thread.messages[thread.messages.length - 1], 'Message-ID') || '';
      let thread_msg_refs_last = Api.gmail.findHeader(thread.messages[thread.messages.length - 1], 'In-Reply-To') || '';
      additional_msg_headers = { 'In-Reply-To': thread_msg_id_last, 'References': thread_msg_refs_last + ' ' + thread_msg_id_last };
    }
  } catch (e) {
    if(Api.err.isAuthPopupNeeded(e)) {
      BrowserMsg.send(parent_tab_id, 'notification_show_auth_popup_needed', {account_email});
    } else if (Api.err.isNetErr(e)) {
      // todo - render retry button
    } else {
      Catch.handle_exception(e);
      // todo - render error
    }
  }

  // send
  $('#send_btn').click(Ui.event.prevent('double', async target => {
    $(target).text('sending..');
    let message = await Api.common.msg(account_email, url_params.from as string, url_params.to as string, url_params.subject as string, {'text/plain': $('#input_text').get(0).innerText}, [att], url_params.thread_id as string);
    for (let k of Object.keys(additional_msg_headers)) {
      message.headers[k] = additional_msg_headers[k];
    }
    try {
      await Api.gmail.msgSend(account_email, message);
      BrowserMsg.send(parent_tab_id, 'notification_show', { notification: 'Message sent.' });
      Xss.sanitize_replace('#compose', 'Message sent. The other person should use this information to send a new message.');
    } catch (e) {
      if(Api.err.isAuthPopupNeeded(e)) {
        $(target).text(send_button_text);
        BrowserMsg.send(parent_tab_id, 'notification_show_auth_popup_needed', {account_email});
        alert('Google account permission needed, please re-connect account and try again.');
      } else if(Api.err.isNetErr(e)) {
        $(target).text(send_button_text);
        alert('No internet connection, please try again.');
      } else {
        Catch.handle_exception(e);
        $(target).text(send_button_text);
        alert('There was an error sending, please try again.');
      }
    }
  }));

})();
