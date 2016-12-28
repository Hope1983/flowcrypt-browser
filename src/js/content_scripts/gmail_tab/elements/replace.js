'use strict';


function init_elements_replace_js() {

  var GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

  window.replace_pgp_elements = function(account_email, addresses, can_read_emails, gmail_tab_id) {
    // expected format <div id=":30" class="ii gt m15241dbd879bdfb4 adP adO"><div id=":2z" class="a3s" style="overflow: hidden;">-----BEGIN PGP MESSAGE-----<br>
    var new_pgp_block_found = replace_armored_pgp_messages(account_email, addresses, gmail_tab_id);
    if(new_pgp_block_found) {
      hide_translate_prompt();
      if(page_refresh_needed()) {
        show_page_refresh_notification();
      }
    }
    replace_standard_reply_box(account_email, gmail_tab_id);
    replace_pgp_attachments(account_email, can_read_emails, gmail_tab_id);
    replace_pgp_pubkeys(account_email, gmail_tab_id);
    replace_cryptup_tags(account_email, gmail_tab_id);
    replace_reply_buttons(account_email, gmail_tab_id);
    replace_attest_packets(account_email, gmail_tab_id);
  };

  window.replace_reply_buttons = function(account_email, gmail_tab_id) {
    if($('iframe.pgp_block').length) { // if convo has pgp blocks
      if(!$('td.acX.replaced').length) { // last reply button in convo gets replaced
        var reply_button = '<div class="reply_message_button"><i class="fa fa-mail-reply"></i>&nbsp;<img src="' + get_logo_src(true) + '" /></div>';
        $('td.acX').not('.replaced').last().addClass('replaced').html(reply_button).click(Try(function() {
          set_reply_box_editable(account_email, gmail_tab_id);
        }));
      } else { // all others get removed
        $('td.acX').not('.replaced').each(function() {
          $(this).addClass('replaced').html('');
        });
      }
    }
  };

  window.hide_translate_prompt = function() {
    $('.adI').css('display', 'none');
  };

  window.replace_cryptup_tags = function(account_email, gmail_tab_id) {
    $("div[contenteditable='true']:contains('[cryptup:link:')").not('.evaluated').each(function() {
      $(this).addClass('evaluated');
      // todo - extremely distastful coding, should use regex match
      var button = '';
      var button_href_id = undefined;
      $(this).html().replace(/\[cryptup:link:([a-z_]+):([0-9a-fr\-]+)\]/g, function(full_link, name, id) {
        if(name === 'draft_compose') {
          button = '<a href="#" class="open_draft">Open draft</a>';
          button_href_id = id;
        } else if(name === 'draft_reply') {
          button = '<a href="#inbox/' + id + '">Open draft</a>';
        } else {
          button = $(this).html(); // shows original pgp message
        }
      });
      $(this).replaceWith(button);
      $('a.open_draft').click(Try(function() {
        $('div.new_message').remove();
        $('body').append(compose_message_iframe(account_email, gmail_tab_id, button_href_id));
      }));
    });
  };

  window.replace_pgp_pubkeys = function(account_email, gmail_tab_id) {
    $("div.adP.adO div.a3s:contains('-----BEGIN PGP PUBLIC KEY BLOCK-----'):contains('-----END PGP PUBLIC KEY BLOCK-----')").each(function() {
      var re_pubkey_blocks = /-----BEGIN PGP PUBLIC KEY BLOCK-----(.|[\r?\n])+?-----END PGP PUBLIC KEY BLOCK-----/gm;
      $(this).html($(this).html().replace(/<\/?span( class="il")>/gi, '').replace(re_pubkey_blocks, function(armored_pubkey_match) {
        return pgp_pubkey_iframe(account_email, strip_pgp_armor(armored_pubkey_match), gmail_tab_id);
      }));
    });
  };

  window.extract_pgp_question = function(message_text) {
    var re_pgp_question = /<a href="(https\:\/\/cryptup\.org\/decrypt[^"]+)"[^>]+>.+<\/a>(<br>\r?\n)+/m;
    var question_match = message_text.match(re_pgp_question);
    if(question_match !== null) {
      return window.striptags(get_url_params(['question'], question_match[1].split('?', 2)[1]).question);
    }
  };

  window.replace_armored_pgp_messages = function(account_email, addresses, gmail_tab_id) {
    var conversation_has_new_pgp_message = false;
    $("div.adP.adO div.a3s:contains('-----BEGIN PGP MESSAGE-----')").not('.has_known_pgp_blocks').each(function() { // for each email that contains PGP message
      $(this).addClass('has_known_pgp_blocks');
      if($(this).html().indexOf('-----END PGP MESSAGE-----') !== -1 || $(this).html().indexOf('<a class="vem"') !== -1) {
        var message_element = this;
        var is_outgoing = addresses.indexOf($(this).closest('.gs').find('span.gD').attr('email')) !== -1;
        var re_pgp_blocks = /-----BEGIN PGP MESSAGE-----(.|[\r?\n])+?((-----END PGP MESSAGE-----)|(\[[^\[]+\]((&nbsp;)|( )|(\r?\n))+<a class="vem"[^>]+>[^<]+<\/a>))/gm;
        var re_pgp_question_sentence = /This&nbsp;message&nbsp;is&nbsp;encrypted\.&nbsp;If&nbsp;you&nbsp;can't&nbsp;read&nbsp;it,&nbsp;visit&nbsp;the&nbsp;following&nbsp;link.*/gm;
        var question = extract_pgp_question($(this).html());
        $(this).html($(this).html().replace(/<\/?span( class="il")>/gi, '').replace(/<wbr>/gm, '').replace(re_pgp_question_sentence, '').replace(re_pgp_blocks, function(armored_pubkey_match) {
          var message_id = parse_message_id_from('message', message_element);
          if(armored_pubkey_match.indexOf('-----END PGP MESSAGE-----') !== -1) { // complete pgp block
            return pgp_block_iframe(strip_pgp_armor(armored_pubkey_match), question, account_email, message_id, is_outgoing, gmail_tab_id);
          } else { // clipped pgp block
            return pgp_block_iframe('', question, account_email, message_id, is_outgoing, gmail_tab_id);
          }
        }));
        conversation_has_new_pgp_message = true;
      }
    });
    return conversation_has_new_pgp_message;
  };

  window.parse_message_id_from = function(element_type, my_element) {
    var selectors = {
      'message': $(my_element).parents('div.adP.adO'),
      'attachment': $(my_element).parent().siblings('div.adP.adO')
    };
    var message_id = null; // todo: maybe need to traverse through all children elements classes of the whole message to get to /^m([0-9a-f]{16})$/ - as a backup
    var classes = [].concat(to_array(selectors[element_type].get(0).classList), to_array(selectors[element_type].children('div.a3s').get(0).classList));
    $.each(classes, function(i, message_class) {
      var match = message_class.match(/^m([0-9a-f]{16})$/);
      if(match) {
        message_id = match[1];
        return false;
      }
    });
    return message_id;
  };

  window.replace_pgp_attachments = function(account_email, can_read_emails, gmail_tab_id) {
    var selectors = get_attachments_selectors(null, ['.pgp', '.gpg', '.asc', 'noname']);
    $(selectors.container).each(function() {
      var new_pgp_messages = $(this).children(selectors.attachments).not('.evaluated');
      if(new_pgp_messages.length) {
        new_pgp_messages.addClass('evaluated');
        var attachment_container_classes = new_pgp_messages.get(0).classList;
        var message_id = parse_message_id_from('attachment', this);
        if(message_id) {
          if(can_read_emails) {
            $(new_pgp_messages).prepend('<div class="attachment_loader">Getting file info..' + get_spinner() + '</div>');
            $(this).addClass('message_id_' + message_id);
            chrome_message_send(null, 'list_pgp_attachments', {
              account_email: account_email,
              message_id: message_id,
            }, function(response) {
              Try(function() {
                if(response.success) {
                  if(response.attachments && response.attachments.length) {
                    replace_pgp_attachments_in_message(account_email, message_id, attachment_container_classes, response.attachments, gmail_tab_id);
                  }
                  if(response.messages && response.messages.length) {
                    hide_pgp_attached_message_and_show(account_email, message_id, attachment_container_classes, response.messages, gmail_tab_id);
                  }
                } else {
                  //todo: show button to retry
                }
              })();
            });
          } else {
            $(new_pgp_messages).prepend('<div class="attachment_loader">Missing Gmail permission to decrypt attachments. <a href="#" class="auth_settings">Settings</a></div>');
            $('.auth_settings').click(Try(function() {
              chrome_message_send(null, 'settings', {
                account_email: account_email,
                page: '/chrome/settings/modules/auth_denied.htm',
              });
            }));
          }
        }
      }
    });
  };

  window.get_attachments_selectors = function(message_id, file_name_ends_array) {
    var attachments = [];
    var container_selector = 'div.aQH';
    if(message_id) {
      container_selector += '.message_id_' + message_id;
    }
    $.each(file_name_ends_array, function(i, file_name_end) {
      attachments.push(((message_id) ? (container_selector + ' > ') : '') + 'span[download_url*="' + file_name_end + ':https"]');
    });
    return {
      container: container_selector,
      attachments: attachments.join(', '),
    };
  };

  window.hide_attachments = function(attachments_selector, attachments_length) {
    if($(attachments_selector).length === attachments_length) {
      // only hide original attachments if we found the same amount of them in raw email
      // can cause duplicate attachments (one original encrypted + one decryptable), but should never result in lost attachments
      $(attachments_selector).css('display', 'none');
    } else {
      $(attachments_selector).children('.attachment_loader').text('Missing file info');
    }
  };

  window.replace_pgp_attachments_in_message = function(account_email, message_id, classes, attachments, gmail_tab_id) {
    var selectors = get_attachments_selectors(message_id, ['.pgp', '.gpg']);
    hide_attachments(selectors.attachments, attachments.length);
    $.each(attachments, function(i, attachment) {
      $(selectors.container).prepend(pgp_attachment_iframe(account_email, attachment, classes, gmail_tab_id));
    });
  };

  window.hide_pgp_attached_message_and_show = function(account_email, message_id, classes, attachments, gmail_tab_id) {
    var selectors = get_attachments_selectors(message_id, ['.asc', 'noname']);
    hide_attachments(selectors.attachments, attachments.length);
    if($('div.a3s.m' + message_id + ' iframe').length === 0) {
      $('span.aVW').css('display', 'none');
      $('div.a3s.m' + message_id).css('display', 'block');
      $('div.a3s.m' + message_id).html(pgp_block_iframe('', null, account_email, message_id, false, gmail_tab_id));
    }
  };

  window.replace_attest_packets = function(account_email, gmail_tab_id) {
    $("div.adP.adO div.a3s:contains('-----BEGIN ATTEST PACKET-----'):contains('-----END ATTEST PACKET-----')").each(function() {
      var re_attest_packet = /-----BEGIN ATTEST PACKET-----(.|[\r?\n])+?-----END ATTEST PACKET-----/gm;
      $(this).html($(this).html().replace(/<\/?span( class="il")>/gi, '').replace(re_attest_packet, function(attest_packet_match) {
        chrome_message_send(null, 'attest_packet_received', {
          account_email: account_email,
          packet: strip_pgp_armor(attest_packet_match),
        });
        return '';
      }));
    });
  };

  window.get_conversation_params = function(account_email, callback) {
    var reply_to_estimate = [$('h3.iw span[email]').last().attr('email').trim()]; // add original sender
    var reply_to = [];
    $('span.hb').last().find('span.g2').each(function() {
      reply_to_estimate.push($(this).attr('email')); // add all recipients including me
    });
    var my_email = account_email;
    account_storage_get(account_email, ['addresses'], function(storage) {
      $.each(reply_to_estimate, function(i, email) {
        storage.addresses = storage.addresses || [account_email];
        if(storage.addresses.indexOf(trim_lower(email)) !== -1) { // my email
          my_email = email;
        } else if(reply_to.indexOf(trim_lower(email)) === -1) { // skip duplicates
          reply_to.push(email); // reply to all except my emails
        }
      });
      if(!reply_to.length) { // happens when user sends email to itself - all reply_to_estimage contained his own emails and got removed
        reply_to = unique(reply_to_estimate);
      }
      callback({
        subject: $('h2.hP').text(),
        reply_to: reply_to,
        addresses: storage.addresses,
        my_email: my_email,
      });
    });
  };

  window.replace_standard_reply_box = function(account_email, gmail_tab_id, editable) {
    if($('div.AO iframe.pgp_block').length && $('h2.hP').first().text() === $('h2.hP').last().text()) { // the first() and last() prevents hidden convos not to trigger replacement (when switching between convos)
      var reply_container_selector = 'div.nr.tMHS5d:not(.reply_message_iframe_container), div.gA td.I5:not(.reply_message_iframe_container)';
      if($(reply_container_selector).length) {
        get_conversation_params(account_email, function(params) {
          editable = editable || $(reply_container_selector)[0].tagName === 'TD';
          var iframe = reply_message_iframe(account_email, gmail_tab_id, params.my_email, params.reply_to.join(','), params.addresses, params.subject, editable);
          $(reply_container_selector).addClass('remove_borders').addClass('reply_message_iframe_container').append(iframe).children(':not(iframe)').css('display', 'none');
        });
      }
    }
  };

  window.set_reply_box_editable = function(account_email, gmail_tab_id) { // for now replaces secure reply box
    var reply_container_iframe_selector = '.reply_message_iframe_container > iframe';
    if($(reply_container_iframe_selector).length) {
      get_conversation_params(account_email, function(params) {
        $(reply_container_iframe_selector).replaceWith(reply_message_iframe(account_email, gmail_tab_id, params.my_email, params.reply_to.join(','), params.addresses, params.subject, true));
      });
    } else {
      replace_standard_reply_box(account_email, gmail_tab_id, true);
    }
  }

  window.reinsert_reply_box = function(account_email, gmail_tab_id, subject, my_email, their_email) {
    account_storage_get(account_email, ['addresses'], function(storage) {
      $('.reply_message_iframe_container').append(reply_message_iframe(account_email, gmail_tab_id, my_email, their_email, storage.addresses, subject, false, true));
    });
  };

}
