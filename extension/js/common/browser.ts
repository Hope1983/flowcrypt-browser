/* © 2016-2018 FlowCrypt Limited. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import * as DOMPurify from 'dompurify';
import { Str, Value, Dict } from './common.js';
import { BrowserMsg } from './extension.js';
import { Store } from './store.js';
import { Api } from './api.js';
import { Pgp } from './pgp.js';
import { mnemonic } from './mnemonic.js';
import { Att } from './att.js';
import { MsgBlock, KeyBlockType } from './mime.js';
import { Settings } from './settings.js';
import { Catch, UnreportableError } from './catch.js';

declare const openpgp: typeof OpenPGP;
declare const qq: any;

type Placement = 'settings' | 'settings_compose' | 'default' | 'dialog' | 'gmail' | 'embedded' | 'compose';
type AttLimits = { count?: number, size?: number, size_mb?: number, oversize?: (newFileSize: number) => void };
type PreventableEventName = 'double' | 'parallel' | 'spree' | 'slowspree' | 'veryslowspree';
type NamedSels = Dict<JQuery<HTMLElement>>;
type KeyImportUiCheckResult = {
  normalized: string; longid: string; passphrase: string; fingerprint: string; decrypted: OpenPGP.key.Key;
  encrypted: OpenPGP.key.Key;
};

export type WebMailName = 'gmail' | 'outlook' | 'inbox' | 'settings';
export type Pwd = { question?: string; answer: string; };
export type WebmailVariantString = null | 'html' | 'standard' | 'new';
export type PassphraseDialogType = 'embedded' | 'sign' | 'attest';
export type BrowserEventErrorHandler = { auth?: () => void, authPopup?: () => void, network?: () => void, other?: (e: any) => void };
export type SelCache = { cached: (name: string) => JQuery<HTMLElement>; now: (name: string) => JQuery<HTMLElement>; sel: (name: string) => string; };
export type UrlParam = string | number | null | undefined | boolean | string[];
export type UrlParams = Dict<UrlParam>;

export interface JQS extends JQueryStatic { featherlight: Function; } // tslint:disable-line:ban-types

export class Browser {

  public static objUrlCreate = (content: Uint8Array | string) => {
    return window.URL.createObjectURL(new Blob([content], { type: 'application/octet-stream' }));
  }

  public static objUrlConsume = async (url: string) => {
    let uint8 = await Api.download(url, null);
    window.URL.revokeObjectURL(url);
    return uint8;
  }

  public static saveToDownloads = (att: Att, renderIn: JQuery<HTMLElement> | null = null) => {
    let blob = new Blob([att.data()], { type: att.type });
    if (window.navigator && window.navigator.msSaveOrOpenBlob) {
      window.navigator.msSaveBlob(blob, att.name);
    } else {
      let a = window.document.createElement('a');
      a.href = window.URL.createObjectURL(blob);
      a.download = Xss.escape(att.name);
      if (renderIn) {
        a.textContent = 'DECRYPTED FILE';
        a.style.cssText = 'font-size: 16px; font-weight: bold;';
        Xss.sanitizeRender(
          renderIn,
          '<div style="font-size: 16px;padding: 17px 0;">File is ready.<br>Right-click the link and select <b>Save Link As</b></div>',
        );
        renderIn.append(a); // xss-escaped attachment name above
        renderIn.css('height', 'auto');
        renderIn.find('a').click(e => {
          alert('Please use right-click and select Save Link As');
          e.preventDefault();
          e.stopPropagation();
          return false;
        });
      } else {
        if (typeof a.click === 'function') {
          a.click();
        } else { // safari
          let e = document.createEvent('MouseEvents');
          // @ts-ignore - safari only. expected 15 arguments, but works well with 4
          e.initMouseEvent('click', true, true, window);
          a.dispatchEvent(e);
        }
        if (Env.browser().name === 'firefox') {
          try {
            document.body.removeChild(a);
          } catch (err) {
            if (err.message !== 'Node was not found') {
              throw err;
            }
          }
        }
        Catch.setHandledTimeout(() => window.URL.revokeObjectURL(a.href), 0);
      }
    }
  }

}

export class Env {

  private static URL_PARAM_DICT: Dict<boolean | null> = { '___cu_true___': true, '___cu_false___': false, '___cu_null___': null };

  public static browser = () => {  // http://stackoverflow.com/questions/4825498/how-can-i-find-out-which-browser-a-user-is-using
    if (/Firefox[\/\s](\d+\.\d+)/.test(navigator.userAgent)) {
      return { name: 'firefox', v: Number(RegExp.$1) };
    } else if (/MSIE (\d+\.\d+);/.test(navigator.userAgent)) {
      return { name: 'ie', v: Number(RegExp.$1) };
    } else if (/Chrome[\/\s](\d+\.\d+)/.test(navigator.userAgent)) {
      return { name: 'chrome', v: Number(RegExp.$1) };
    } else if (/Opera[\/\s](\d+\.\d+)/.test(navigator.userAgent)) {
      return { name: 'opera', v: Number(RegExp.$1) };
    } else if (/Safari[\/\s](\d+\.\d+)/.test(navigator.userAgent)) {
      return { name: 'safari', v: Number(RegExp.$1) };
    } else {
      return { name: 'unknown', v: null };
    }
  }

  public static runtimeId = (orig = false) => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      if (orig === true) {
        return chrome.runtime.id;
      } else {
        return chrome.runtime.id.replace(/[^a-z0-9]/gi, '');
      }
    }
    return null;
  }

  public static isBackgroundPage = () => Boolean(window.location && Value.is('background_page.htm').in(window.location.href));

  public static isExtension = () => Env.runtimeId() !== null;

  public static urlParamRequire = {
    string: (values: UrlParams, name: string): string => Ui.abortAndRenderErrOnUrlParamTypeMismatch(values, name, 'string') as string,
    oneof: (values: UrlParams, name: string, allowed: UrlParam[]): string => Ui.abortAndRenderErrOnUrlParamValMismatch(values, name, allowed) as string,
  };

  private static snakeCaseToCamelCase = (s: string) => s.replace(/_[a-z]/g, boundary => boundary[1].toUpperCase());

  private static camelCaseToSnakeCase = (s: string) => s.replace(/[a-z][A-Z]/g, boundary => `${boundary[0]}_${boundary[1].toLowerCase()}`);

  private static findAndProcessUrlParam = (expectedParamName: string, rawParamNameDict: Dict<string>, rawParms: Dict<string>): UrlParam => {
    if (typeof rawParamNameDict[expectedParamName] === 'undefined') {
      return undefined; // param name not found in param name dict
    }
    let rawValue = rawParms[rawParamNameDict[expectedParamName]];
    if (typeof rawValue === 'undefined') {
      return undefined; // original param name not found in raw params
    }
    if (typeof Env.URL_PARAM_DICT[rawValue] !== 'undefined') {
      return Env.URL_PARAM_DICT[rawValue]; // raw value was converted using a value dict to get proper: true, false, undefined, null
    }
    return decodeURIComponent(rawValue);
  }

  private static fillPossibleUrlParamNameVariations = (urlParamName: string, rawParamNameDict: Dict<string>) => {
    rawParamNameDict[urlParamName] = urlParamName;
    rawParamNameDict[Env.snakeCaseToCamelCase(urlParamName)] = urlParamName;
    rawParamNameDict[Env.camelCaseToSnakeCase(urlParamName)] = urlParamName;
    let shortened = urlParamName.replace('account', 'acct').replace('message', 'msg').replace('attachment', 'att');
    rawParamNameDict[Env.snakeCaseToCamelCase(shortened)] = urlParamName;
    rawParamNameDict[Env.camelCaseToSnakeCase(shortened)] = urlParamName;
  }

  /**
   * will convert result to desired format: camelCase or snake_case, based on what was supplied in expectedKeys
   */
  public static urlParams = (expectedKeys: string[], string: string | null = null) => {
    let url = (string || window.location.search.replace('?', ''));
    let valuePairs = url.split('?').pop()!.split('&'); // str.split('?') string[].length will always be >= 1
    let rawParms: Dict<string> = {};
    let rawParamNameDict: Dict<string> = {};
    for (let valuePair of valuePairs) {
      let pair = valuePair.split('=');
      rawParms[pair[0]] = pair[1];
      Env.fillPossibleUrlParamNameVariations(pair[0], rawParamNameDict);
    }
    let processedParams: UrlParams = {};
    for (let expectedKey of expectedKeys) {
      processedParams[expectedKey] = Env.findAndProcessUrlParam(expectedKey, rawParamNameDict, rawParms);
    }
    return processedParams;
  }

  public static urlCreate = (link: string, params: UrlParams) => {
    for (let key of Object.keys(params)) {
      let value = params[key];
      if (typeof value !== 'undefined') {
        let transformed = Value.obj.keyByValue(Env.URL_PARAM_DICT, value);
        link += (!Value.is('?').in(link) ? '?' : '&') + encodeURIComponent(key) + '=' + encodeURIComponent(String(typeof transformed !== 'undefined' ? transformed : value));
      }
    }
    return link;
  }

  public static keyCodes = () => {
    return { a: 97, r: 114, A: 65, R: 82, f: 102, F: 70, backspace: 8, tab: 9, enter: 13, comma: 188, };
  }

  public static webmails = async (): Promise<WebMailName[]> => {
    return ['gmail', 'inbox']; // async because storage may be involved in the future
  }

}

export class Ui {

  public static EVENT_DOUBLE_MS = 1000;
  public static EVENT_SPREE_MS = 50;
  public static EVENT_SLOW_SPREE_MS = 200;
  public static EVENT_VERY_SLOW_SPREE_MS = 500;

  public static retryLink = (caption: string = 'retry') => `<a href="${Xss.escape(window.location.href)}">${Xss.escape(caption)}</a>`;

  public static delay = (ms: number) => new Promise(resolve => Catch.setHandledTimeout(resolve, ms));

  public static spinner = (color: string, placeholderCls: "small_spinner" | "large_spinner" = 'small_spinner') => {
    let path = `/img/svgs/spinner-${color}-small.svg`;
    let url = typeof chrome !== 'undefined' && chrome.extension && chrome.extension.getURL ? chrome.extension.getURL(path) : path;
    return `<i class="${placeholderCls}" data-test="spinner"><img src="${url}" /></i>`;
  }

  public static renderOverlayPromptAwaitUserChoice = (btns: Dict<{ title?: string, color?: string }>, prompt: string): Promise<string> => {
    return new Promise(resolve => {
      let getEscapedColor = (id: string) => Xss.escape(btns[id].color || 'green');
      let getEscapedTitle = (id: string) => Xss.escape(btns[id].title || id.replace(/_/g, ' '));
      let formatBtn = (id: string) => `<div class="button ${getEscapedColor(id)} overlay_action_${Xss.escape(id)}">${getEscapedTitle(id)}</div>`;
      let formattedBtns = Object.keys(btns).map(formatBtn).join('&nbsp;'.repeat(5));
      Xss.sanitizeAppend('body', `
        <div class="featherlight white prompt_overlay" style="display: block;">
          <div class="featherlight-content" data-test="dialog">
            <div class="line">${prompt.replace(/\n/g, '<br>')}</div>
            <div class="line">${formattedBtns}</div>
            <div class="line">&nbsp;</div>
            <div class="line">Email human@flowcrypt.com if you need assistance.</div>
          </div>
        </div>
      `);
      let overlay = $('.prompt_overlay');
      for (let id of Object.keys(btns)) {
        overlay.find(`.overlay_action_${id}`).one('click', () => {
          overlay.remove();
          resolve(id);
        });
      }
    });
  }

  public static abortAndRenderErrOnUnprotectedKey = async (acctEmail?: string, tabId?: string) => {
    if (acctEmail) {
      let [primaryKi] = await Store.keysGet(acctEmail, ['primary']);
      let { setup_done, setup_simple } = await Store.getAcct(acctEmail, ['setup_simple', 'setup_done']);
      if (setup_done && setup_simple && primaryKi && openpgp.key.readArmored(primaryKi.private).keys[0].isDecrypted()) {
        if (window.location.pathname === '/chrome/settings/index.htm') {
          // @ts-ignore - this lets it compile in content script that is missing Settings
          Settings.renderSubPage(acctEmail, tabId!, '/chrome/settings/modules/change_passphrase.htm');
        } else {
          let msg = `Protect your key with a pass phrase to finish setup.`;
          let r = await Ui.renderOverlayPromptAwaitUserChoice({ finishSetup: {}, later: { color: 'gray' } }, msg);
          if (r === 'finish_setup') {
            BrowserMsg.send(null, 'settings', { acctEmail });
          }
        }
      }
    }
  }

  public static abortAndRenderErrOnUrlParamTypeMismatch = (values: UrlParams, name: string, expectedType: string): UrlParam => {
    let actualType = typeof values[name];
    if (actualType !== expectedType) {
      // tslint:disable-next-line:max-line-length
      let msg = `Cannot render page (expected ${Xss.escape(name)} to be of type ${Xss.escape(expectedType)} but got ${Xss.escape(actualType)})<br><br>Was the URL editted manually? Please write human@flowcrypt.com for help.`;
      Xss.sanitizeRender('body', msg).addClass('bad').css({ padding: '20px', 'font-size': '16px' });
      throw new UnreportableError(msg);
    }
    return values[name];
  }

  public static abortAndRenderErrOnUrlParamValMismatch = <T>(values: Dict<T>, name: string, expectedVals: T[]): T => {
    if (expectedVals.indexOf(values[name]) === -1) {
      // tslint:disable-next-line:max-line-length
      let msg = `Cannot render page (expected ${Xss.escape(name)} to be one of ${Xss.escape(expectedVals.map(String).join(','))} but got ${Xss.escape(String(values[name]))}<br><br>Was the URL editted manually? Please write human@flowcrypt.com for help.`;
      Xss.sanitizeRender('body', msg).addClass('bad').css({ padding: '20px', 'font-size': '16px' });
      throw new UnreportableError(msg);
    }
    return values[name];
  }

  public static passphraseToggle = async (passphraseInputIds: string[], forceInitialShowOrHide: "show" | "hide" | null = null) => {
    let buttonHide = '<img src="/img/svgs/eyeclosed-icon.svg" class="eye-closed"><br>hide';
    let buttonShow = '<img src="/img/svgs/eyeopen-icon.svg" class="eye-open"><br>show';
    let { hidePassphrases } = await Store.getGlobal(['hide_pass_phrases']);
    let show: boolean;
    if (forceInitialShowOrHide === 'hide') {
      show = false;
    } else if (forceInitialShowOrHide === 'show') {
      show = true;
    } else {
      show = !hidePassphrases;
    }
    for (let id of passphraseInputIds) {
      let passphraseInput = $('#' + id);
      passphraseInput.addClass('toggled_passphrase');
      if (show) {
        passphraseInput.after('<label href="#" id="toggle_' + id + '" class="toggle_show_hide_pass_phrase" for="' + id + '">' + buttonHide + '</label>');
        passphraseInput.attr('type', 'text');
      } else {
        passphraseInput.after('<label href="#" id="toggle_' + id + '" class="toggle_show_hide_pass_phrase" for="' + id + '">' + buttonShow + '</label>');
        passphraseInput.attr('type', 'password');
      }
      $('#toggle_' + id).click(Ui.event.handle(target => {
        if (passphraseInput.attr('type') === 'password') {
          $('#' + id).attr('type', 'text');
          Xss.sanitizeRender(target, buttonHide);
          Store.set(null, { hide_pass_phrases: false }).catch(Catch.rejection);
        } else {
          $('#' + id).attr('type', 'password');
          Xss.sanitizeRender(target, buttonShow);
          Store.set(null, { hide_pass_phrases: true }).catch(Catch.rejection);
        }
      }));
    }
  }

  public static enter = (callback: () => void) => (e: JQuery.Event<HTMLElement, null>) => { // returns a function
    if (e.which === Env.keyCodes().enter) {
      callback();
    }
  }

  public static buildJquerySels = (sels: Dict<string>): SelCache => {
    let cache: NamedSels = {};
    return {
      cached: (name: string) => {
        if (!cache[name]) {
          if (typeof sels[name] === 'undefined') {
            Catch.report('unknown selector name: ' + name);
          }
          cache[name] = $(sels[name]);
        }
        return cache[name];
      },
      now: (name: string) => {
        if (typeof sels[name] === 'undefined') {
          Catch.report('unknown selector name: ' + name);
        }
        return $(sels[name]);
      },
      sel: (name: string) => {
        if (typeof sels[name] === 'undefined') {
          Catch.report('unknown selector name: ' + name);
        }
        return sels[name];
      }
    };
  }

  public static scroll = (sel: string | JQuery<HTMLElement>, repeat: number[] = []) => {
    let el = $(sel as string).first()[0]; // as string due to JQuery TS quirk
    if (el) {
      el.scrollIntoView();
      for (let delay of repeat) { // useful if mobile keyboard is about to show up
        Catch.setHandledTimeout(() => el.scrollIntoView(), delay);
      }
    }
  }

  public static event = {
    clicked: (selector: string): Promise<HTMLElement> => new Promise(resolve => $(selector).one('click', function () { resolve(this); })),
    stop: () => (e: JQuery.Event) => { // returns a function
      e.preventDefault();
      e.stopPropagation();
      return false;
    },
    protect: () => {
      // prevent events that could potentially leak information about sensitive info from bubbling above the frame
      $('body').on('keyup keypress keydown click drag drop dragover dragleave dragend submit', e => {
        // don't ask me how come Chrome allows it to bubble cross-domain
        // should be used in embedded frames where the parent cannot be trusted (eg parent is webmail)
        // should be further combined with iframe type=content + sandboxing, but these could potentially be changed by the parent frame
        // so this indeed seems like the only defense
        // happened on only one machine, but could potentially happen to other users as well
        // if you know more than I do about the hows and whys of events bubbling out of iframes on different domains, let me know
        e.stopPropagation();
      });
    },
    handle: (cb: (e: HTMLElement, event: JQuery.Event<HTMLElement, null>) => void | Promise<void>, errHandler?: BrowserEventErrorHandler) => {
      return function (event: JQuery.Event<HTMLElement, null>) {
        let r;
        try {
          r = cb(this, event);
          if (typeof r === 'object' && typeof r.catch === 'function') {
            r.catch(e => Ui.event._dispatchErr(e, errHandler));
          }
        } catch (e) {
          Ui.event._dispatchErr(e, errHandler);
        }
      };
    },
    _dispatchErr: (e: any, errHandler?: BrowserEventErrorHandler) => {
      if (Api.err.isNetErr(e) && errHandler && errHandler.network) {
        errHandler.network();
      } else if (Api.err.isAuthErr(e) && errHandler && errHandler.auth) {
        errHandler.auth();
      } else if (Api.err.isAuthPopupNeeded(e) && errHandler && errHandler.authPopup) {
        errHandler.authPopup();
      } else if (errHandler && errHandler.other) {
        errHandler.other(e);
      } else {
        Catch.handleException(e);
      }
    },
    prevent: (preventableEvent: PreventableEventName, cb: (e: HTMLElement, resetTimer: () => void) => void | Promise<void>, errHandler?: BrowserEventErrorHandler) => {
      let eventTimer: number | undefined;
      let eventFiredOn: number | undefined;
      let cbResetTimer = () => {
        eventTimer = undefined;
        eventFiredOn = undefined;
      };
      let cbWithErrsHandled = (e: HTMLElement) => {
        let r;
        try {
          r = cb(e, cbResetTimer);
          if (typeof r === 'object' && typeof r.catch === 'function') {
            r.catch(e => Ui.event._dispatchErr(e, errHandler));
          }
        } catch (e) {
          Ui.event._dispatchErr(e, errHandler);
        }
      };
      return function () {
        if (preventableEvent === 'spree') {
          clearTimeout(eventTimer);
          eventTimer = Catch.setHandledTimeout(() => cbWithErrsHandled(this), Ui.EVENT_SPREE_MS);
        } else if (preventableEvent === 'slowspree') {
          clearTimeout(eventTimer);
          eventTimer = Catch.setHandledTimeout(() => cbWithErrsHandled(this), Ui.EVENT_SLOW_SPREE_MS);
        } else if (preventableEvent === 'veryslowspree') {
          clearTimeout(eventTimer);
          eventTimer = Catch.setHandledTimeout(() => cbWithErrsHandled(this), Ui.EVENT_VERY_SLOW_SPREE_MS);
        } else {
          if (eventFiredOn) {
            if (preventableEvent === 'parallel') {
              // event handling is still being processed. Do not call back
            } else if (preventableEvent === 'double') {
              if (Date.now() - eventFiredOn > Ui.EVENT_DOUBLE_MS) {
                eventFiredOn = Date.now();
                cbWithErrsHandled(this);
              }
            }
          } else {
            eventFiredOn = Date.now();
            cbWithErrsHandled(this);
          }
        }
      };
    }
  };

  /**
   * XSS WARNING
   *
   * Return values are inserted directly into DOM. Results must be html escaped.
   *
   * When edited, REQUEST A SECOND SET OF EYES TO REVIEW CHANGES
   */
  public static renderableMsgBlock = (factory: XssSafeFactory, block: MsgBlock, msgId?: string, senderEmail?: string, isOutgoing?: boolean) => {
    if (block.type === 'text' || block.type === 'privateKey') {
      return Xss.escape(block.content).replace(/\n/g, '<br>') + '<br><br>';
    } else if (block.type === 'message') {
      return factory.embeddedMsg(block.complete ? Pgp.armor.normalize(block.content, 'message') : '', msgId, isOutgoing, senderEmail, false);
    } else if (block.type === 'signedMsg') {
      return factory.embeddedMsg(block.content, msgId, isOutgoing, senderEmail, false);
    } else if (block.type === 'publicKey') {
      return factory.embeddedPubkey(Pgp.armor.normalize(block.content, 'publicKey'), isOutgoing);
    } else if (block.type === 'passwordMsg') {
      return factory.embeddedMsg('', msgId, isOutgoing, senderEmail, true, undefined, block.content); // here block.content is message short id
    } else if (block.type === 'attestPacket') {
      return factory.embeddedAttest(block.content);
    } else if (block.type === 'cryptupVerification') {
      return factory.embeddedVerification(block.content);
    } else {
      Catch.report('dunno how to process block type: ' + block.type);
      return '';
    }
  }

  public static time = {
    wait: (untilThisFunctionEvalsTrue: () => boolean | undefined) => new Promise((success, error) => {
      let interval = Catch.setHandledInterval(() => {
        let result = untilThisFunctionEvalsTrue();
        if (result === true) {
          clearInterval(interval);
          if (success) {
            success();
          }
        } else if (result === false) {
          clearInterval(interval);
          if (error) {
            error();
          }
        }
      }, 50);
    }),
    sleep: (ms: number, setCustomTimeout: (code: () => void, t: number) => void = Catch.setHandledTimeout) => new Promise(resolve => setCustomTimeout(resolve, ms)),
  };

  public static e = (name: string, attrs: Dict<string>) => $(`<${name}/>`, attrs)[0].outerHTML; // xss-tested: jquery escapes attributes

}

export class Xss {

  private static ALLOWED_HTML_TAGS = ['p', 'div', 'br', 'u', 'i', 'em', 'b', 'ol', 'ul', 'pre', 'li', 'table', 'tr', 'td', 'th', 'img', 'h1', 'h2', 'h3', 'h4', 'h5',
    'h6', 'hr', 'address', 'blockquote', 'dl', 'fieldset', 'a', 'font'];
  private static ADD_ATTR = ['email', 'page', 'addurltext', 'longid', 'index'];
  private static HREF_REGEX_CACHE = null as null | RegExp;

  public static sanitizeRender = (selector: string | HTMLElement | JQuery<HTMLElement>, dirtyHtml: string) => $(selector as any).html(Xss.htmlSanitize(dirtyHtml)); // xss-sanitized

  public static sanitizeAppend = (selector: string | HTMLElement | JQuery<HTMLElement>, dirtyHtml: string) => $(selector as any).append(Xss.htmlSanitize(dirtyHtml)); // xss-sanitized

  public static sanitizePrepend = (selector: string | HTMLElement | JQuery<HTMLElement>, dirtyHtml: string) => $(selector as any).prepend(Xss.htmlSanitize(dirtyHtml)); // xss-sanitized

  public static sanitizeReplace = (selector: string | HTMLElement | JQuery<HTMLElement>, dirtyHtml: string) => $(selector as any).replaceWith(Xss.htmlSanitize(dirtyHtml)); // xss-sanitized

  public static htmlSanitize = (dirtyHtml: string): string => { // originaly text_or_html
    return DOMPurify.sanitize(dirtyHtml, {
      SAFE_FOR_JQUERY: true,
      ADD_ATTR: Xss.ADD_ATTR,
      ALLOWED_URI_REGEXP: Xss.sanitizeHrefRegexp(),
    });
  }

  public static htmlSanitizeKeepBasicTags = (dirtyHtml: string): string => {
    // used whenever untrusted remote content (eg html email) is rendered, but we still want to preserve html
    DOMPurify.removeAllHooks();
    DOMPurify.addHook('afterSanitizeAttributes', node => {
      if ('src' in node) {
        // replace images with a link that points to that image
        let img: Element = node;
        let src = img.getAttribute('src')!;
        let title = img.getAttribute('title');
        img.removeAttribute('src');
        let a = document.createElement('a');
        a.href = src;
        a.className = 'image_src_link';
        a.target = '_blank';
        a.innerText = title || 'show image';
        let heightWidth = `height: ${img.clientHeight ? `${Number(img.clientHeight)}px` : 'auto'}; width: ${img.clientWidth ? `${Number(img.clientWidth)}px` : 'auto'};`;
        a.setAttribute('style', `text-decoration: none; background: #FAFAFA; padding: 4px; border: 1px dotted #CACACA; display: inline-block; ${heightWidth}`);
        img.outerHTML = a.outerHTML; // xss-safe-value - "a" was build using dom node api
      }
      if ('target' in node) { // open links in new window
        (node as Element).setAttribute('target', '_blank');
      }
    });
    let cleanHtml = DOMPurify.sanitize(dirtyHtml, {
      SAFE_FOR_JQUERY: true,
      ADD_ATTR: Xss.ADD_ATTR,
      ALLOWED_TAGS: Xss.ALLOWED_HTML_TAGS,
      ALLOWED_URI_REGEXP: Xss.sanitizeHrefRegexp(),
    });
    DOMPurify.removeAllHooks();
    return cleanHtml;
  }

  public static htmlSanitizeAndStripAllTags = (dirtyHtml: string, outputNl: string): string => {
    let html = Xss.htmlSanitizeKeepBasicTags(dirtyHtml);
    let random = Str.random(5);
    let br = `CU_BR_${random}`;
    let blockStart = `CU_BS_${random}`;
    let blockEnd = `CU_BE_${random}`;
    html = html.replace(/<br[^>]*>/gi, br);
    html = html.replace(/\n/g, '');
    html = html.replace(/<\/(p|h1|h2|h3|h4|h5|h6|ol|ul|pre|address|blockquote|dl|div|fieldset|form|hr|table)[^>]*>/gi, blockEnd);
    html = html.replace(/<(p|h1|h2|h3|h4|h5|h6|ol|ul|pre|address|blockquote|dl|div|fieldset|form|hr|table)[^>]*>/gi, blockStart);
    html = html.replace(RegExp(`(${blockStart})+`, 'g'), blockStart).replace(RegExp(`(${blockEnd})+`, 'g'), blockEnd);
    html = html.split(blockEnd + blockStart).join(br).split(br + blockEnd).join(br);
    let text = html.split(br).join('\n').split(blockStart).filter(v => !!v).join('\n').split(blockEnd).filter(v => !!v).join('\n');
    text = text.replace(/\n{2,}/g, '\n\n');
    // not all tags were removed above. Remove all remaining tags
    text = DOMPurify.sanitize(text, { SAFE_FOR_JQUERY: true, ALLOWED_TAGS: [] });
    text = text.trim();
    if (outputNl !== '\n') {
      text = text.replace(/\n/g, outputNl);
    }
    return text;
  }

  public static escape = (str: string) => str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\//g, '&#x2F;');

  public static htmlUnescape = (str: string) => {
    // the &nbsp; at the end is replaced with an actual NBSP character, not a space character. IDE won't show you the difference. Do not change.
    return str.replace(/&#x2F;/g, '/').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  }

  private static sanitizeHrefRegexp = () => { // allow href links that have same origin as our extension + cid
    if (Xss.HREF_REGEX_CACHE === null) {
      if (window && window.location && window.location.origin && window.location.origin.match(/^(?:chrome-extension|moz-extension):\/\/[a-z0-9\-]+$/g)) {
        Xss.HREF_REGEX_CACHE = new RegExp(`^(?:(http|https|cid):|${Str.regexEscape(window.location.origin)}|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))`, 'i');
      } else {
        Xss.HREF_REGEX_CACHE = /^(?:(http|https):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
      }
    }
    return Xss.HREF_REGEX_CACHE;
  }

}

export class XssSafeFactory {

  /**
   * XSS WARNING
   *
   * Method return values are inserted directly into DOM.
   *
   * All public methods are expected to escape unknown content to prevent XSS.
   *
   * If you add or edit a method, REQUEST A SECOND SET OF EYES TO REVIEW CHANGES
   */

  private setParams: UrlParams;
  private reloadableCls: string;
  private destroyableCls: string;
  private hideGmailNewMsgInThreadNotification = '<style>.ata-asE { display: none !important; visibility: hidden !important; }</style>';

  constructor(acctEmail: string, parentTabId: string, reloadableCls: string = '', destroyableCls: string = '', setParams: UrlParams = {}) {
    this.reloadableCls = Xss.escape(reloadableCls);
    this.destroyableCls = Xss.escape(destroyableCls);
    this.setParams = setParams;
    this.setParams.acctEmail = acctEmail;
    this.setParams.parentTabId = parentTabId;
  }

  srcImg = (relPath: string) => this.extUrl(`img/${relPath}`);

  private frameSrc = (path: string, params: UrlParams = {}) => {
    for (let k of Object.keys(this.setParams)) {
      params[k] = this.setParams[k];
    }
    return Env.urlCreate(path, params);
  }

  srcComposeMsg = (draftId?: string) => {
    return this.frameSrc(this.extUrl('chrome/elements/compose.htm'), { isReplyBox: false, draftId, placement: 'gmail' });
  }

  srcPassphraseDialog = (longids: string[] = [], type: PassphraseDialogType) => {
    return this.frameSrc(this.extUrl('chrome/elements/passphrase.htm'), { type, longids });
  }

  srcSubscribeDialog = (verificationEmailText?: string, placement?: Placement, source?: string, subscribeResultTabId?: string) => {
    return this.frameSrc(this.extUrl('chrome/elements/subscribe.htm'), { verificationEmailText, placement, source, subscribeResultTabId });
  }

  srcVerificationDialog = (verificationEmailText: string) => {
    return this.frameSrc(this.extUrl('chrome/elements/verification.htm'), { verificationEmailText });
  }

  srcAttest = (attestPacket: string) => {
    return this.frameSrc(this.extUrl('chrome/elements/attest.htm'), { attestPacket, });
  }

  srcAddPubkeyDialog = (emails: string[], placement: Placement) => {
    return this.frameSrc(this.extUrl('chrome/elements/add_pubkey.htm'), { emails, placement });
  }

  srcAddFooterDialog = (placement: Placement) => {
    return this.frameSrc(this.extUrl('chrome/elements/shared/footer.htm'), { placement });
  }

  srcSendingAddrDialog = (placement: Placement) => {
    return this.frameSrc(this.extUrl('chrome/elements/sending_address.htm'), { placement });
  }

  srcPgpAttIframe = (a: Att) => {
    if (!a.id && !a.url && a.hasData()) { // data provided directly, pass as object url
      a.url = Browser.objUrlCreate(a.asBytes());
    }
    return this.frameSrc(this.extUrl('chrome/elements/attachment.htm'), { frameId: this.newId(), msgId: a.msgId, name: a.name, type: a.type, size: a.length, attId: a.id, url: a.url });
  }

  srcPgpBlockIframe = (message: string, msgId?: string, isOutgoing?: boolean, senderEmail?: string, hasPassword?: boolean, signature?: string | boolean, short?: string) => {
    return this.frameSrc(this.extUrl('chrome/elements/pgp_block.htm'), { frameId: this.newId(), message, hasPassword, msgId, senderEmail, isOutgoing, signature, short });
  }

  srcPgpPubkeyIframe = (armoredPubkey: string, isOutgoind?: boolean) => {
    return this.frameSrc(this.extUrl('chrome/elements/pgp_pubkey.htm'), { frameId: this.newId(), armoredPubkey, minimized: Boolean(isOutgoind), });
  }

  srcReplyMsgIframe = (convoParams: UrlParams, skipClickPrompt: boolean, ignoreDraft: boolean) => {
    let params: UrlParams = {
      isReplyBox: true,
      frameId: 'frame_' + Str.random(10),
      placement: 'gmail',
      threadId: convoParams.threadId,
      skipClickPrompt: Boolean(skipClickPrompt),
      ignoreDraft: Boolean(ignoreDraft),
      threadMsgId: convoParams.threadMsgId,
    };
    if (convoParams.replyTo) { // for gmail and inbox. Outlook gets this from API
      let headers = this.resolveFromTo(convoParams.addresses as string[], convoParams.myEmail as string, convoParams.replyTo as string[]);
      params.to = headers.to;
      params.from = headers.from;
      params.subject = 'Re: ' + convoParams.subject;
    }
    return this.frameSrc(this.extUrl('chrome/elements/compose.htm'), params);
  }

  srcStripeCheckout = () => {
    return this.frameSrc('https://flowcrypt.com/stripe.htm', {});
  }

  metaNotificationContainer = () => {
    return `<div class="${this.destroyableCls} webmail_notifications" style="text-align: center;"></div>`;
  }

  metaStylesheet = (file: string) => {
    return `<link class="${this.destroyableCls}" rel="stylesheet" href="${this.extUrl(`css/${file}.css`)}" />`;
  }

  dialogPassphrase = (longids: string[], type: PassphraseDialogType) => {
    return this.divDialog_DANGEROUS(this.iframe(this.srcPassphraseDialog(longids, type), ['medium'], { scrolling: 'no' }), 'dialog-passphrase'); // xss-safe-factory
  }

  dialogSubscribe = (verifEmailText?: string, source?: string, subscribeResultTabId?: string) => {
    let src = this.srcSubscribeDialog(verifEmailText, 'dialog', source, subscribeResultTabId);
    return this.divDialog_DANGEROUS(this.iframe(src, ['mediumtall'], { scrolling: 'no' }), 'dialog-subscribe'); // xss-safe-factory
  }

  dialogAddPubkey = (emails: string[]) => {
    return this.divDialog_DANGEROUS(this.iframe(this.srcAddPubkeyDialog(emails, 'gmail'), ['tall'], { scrolling: 'no' }), 'dialog-add-pubkey'); // xss-safe-factory
  }

  embeddedCompose = (draftId?: string) => {
    return Ui.e('div', { id: 'new_message', class: 'new_message', 'data-test': 'container-new-message', html: this.iframe(this.srcComposeMsg(draftId), [], { scrolling: 'no' }) });
  }

  embeddedSubscribe = (verifEmailText: string, source: string) => {
    return this.iframe(this.srcSubscribeDialog(verifEmailText, 'embedded', source), ['short', 'embedded'], { scrolling: 'no' });
  }

  embeddedVerification = (verifEmailText: string) => {
    return this.iframe(this.srcVerificationDialog(verifEmailText), ['short', 'embedded'], { scrolling: 'no' });
  }

  embeddedAtta = (meta: Att) => {
    return Ui.e('span', { class: 'pgp_attachment', html: this.iframe(this.srcPgpAttIframe(meta)) });
  }

  embeddedMsg = (armored: string, msgId?: string, isOutgoing?: boolean, sender?: string, hasPassword?: boolean, signature?: string | boolean, short?: string) => {
    return this.iframe(this.srcPgpBlockIframe(armored, msgId, isOutgoing, sender, hasPassword, signature, short), ['pgp_block']) + this.hideGmailNewMsgInThreadNotification;
  }

  embeddedPubkey = (armoredPubkey: string, isOutgoing?: boolean) => {
    return this.iframe(this.srcPgpPubkeyIframe(armoredPubkey, isOutgoing), ['pgp_block']);
  }

  embeddedReply = (convoParams: UrlParams, skipClickPrompt: boolean, ignoreDraft: boolean = false) => {
    return this.iframe(this.srcReplyMsgIframe(convoParams, skipClickPrompt, ignoreDraft), ['reply_message']);
  }

  embeddedPassphrase = (longids: string[]) => {
    return this.divDialog_DANGEROUS(this.iframe(this.srcPassphraseDialog(longids, 'embedded'), ['medium'], { scrolling: 'no' }), 'embedded-passphrase'); // xss-safe-factory
  }

  embeddedAttaStatus = (content: string) => {
    return Ui.e('div', { class: 'attachment_loader', html: Xss.htmlSanitize(content) });
  }

  embeddedAttest = (attestPacket: string) => {
    return this.iframe(this.srcAttest(attestPacket), ['short', 'embedded'], { scrolling: 'no' });
  }

  embeddedStripeCheckout = () => {
    return this.iframe(this.srcStripeCheckout(), [], { sandbox: 'allow-forms allow-scripts allow-same-origin' });
  }

  btnCompose = (webmailName: WebMailName) => {
    if (webmailName === 'inbox') {
      let logo = `<div class="new_message_button y pN oX" tabindex="0" data-test="action-secure-compose"><img src="${this.srcImg('logo/logo.svg')}"/></div>`;
      return `<div class="S ${this.destroyableCls}">${logo}<label class="bT qV" id="cryptup_compose_button_label"><div class="tv">Secure Compose</div></label></div>`;
    } else if (webmailName === 'outlook') {
      let btn = `<div class="new_message_button" title="New Secure Email"><img src="${this.srcImg('logo-19-19.png')}"></div>`;
      return `<div class="_fce_c ${this.destroyableCls} cryptup_compose_button_container" role="presentation">${btn}</div>`;
    } else {
      let btn = `<div class="new_message_button T-I J-J5-Ji T-I-KE L3" id="flowcrypt_new_message_button" role="button" tabindex="0" data-test="action-secure-compose">Secure Compose</div>`;
      return `<div class="${this.destroyableCls} z0">${btn}</div>`;
    }
  }

  btnReply = () => {
    return `<div class="${this.destroyableCls} reply_message_button"><img src="${this.srcImg('svgs/reply-icon.svg')}" /></div>`;
  }

  btnWithoutFc = () => {
    let span = `<span>see original</span>`;
    return `<span class="hk J-J5-Ji cryptup_convo_button show_original_conversation ${this.destroyableCls}" data-tooltip="Show conversation without FlowCrypt">${span}</span>`;
  }

  btnWithFc = () => {
    return `<span class="hk J-J5-Ji cryptup_convo_button use_secure_reply ${this.destroyableCls}" data-tooltip="Use Secure Reply"><span>secure reply</span></span>`;
  }

  btnRecipientsUseEncryption = (webmailName: WebMailName) => {
    if (webmailName !== 'gmail') {
      Catch.report('switch_to_secure not implemented for ' + webmailName);
      return '';
    } else {
      return '<div class="aoD az6 recipients_use_encryption">Your recipients seem to have encryption set up! <a href="#">Secure Compose</a></div>';
    }
  }

  private extUrl = (s: string) => chrome.extension.getURL(s);

  private newId = () => `frame_${Str.random(10)}`;

  private resolveFromTo = (secondaryEmails: string[], myEmail: string, theirEmails: string[]) => {
    // when replaying to email I've sent myself, make sure to send it to the other person, and not myself
    if (theirEmails.length === 1 && Value.is(theirEmails[0]).in(secondaryEmails)) {
      return { from: theirEmails[0], to: myEmail }; // replying to myself, reverse the values to actually write to them
    }
    return { to: theirEmails, from: myEmail };
  }

  private iframe = (src: string, classes: string[] = [], elAttributes: UrlParams = {}) => {
    let id = Env.urlParams(['frameId'], src).frameId as string;
    let classAttribute = (classes || []).concat(this.reloadableCls).join(' ');
    let attrs: Dict<string> = { id, class: classAttribute, src };
    for (let name of Object.keys(elAttributes)) {
      attrs[name] = String(elAttributes[name]);
    }
    return Ui.e('iframe', attrs);
  }

  // tslint:disable-next-line:variable-name
  private divDialog_DANGEROUS = (content_MUST_BE_XSS_SAFE: string, dataTest: string) => { // xss-dangerous-function
    return Ui.e('div', { id: 'cryptup_dialog', html: content_MUST_BE_XSS_SAFE, 'data-test': dataTest });
  }

}

export class KeyCanBeFixed extends Error {
  encrypted: OpenPGP.key.Key;
}

export class UserAlert extends Error { }

export class KeyImportUi {

  private expectedLongid: string | null;
  private rejectKnown: boolean;
  private checkEncryption: boolean;
  private checkSigning: boolean;
  public onBadPassphrase: VoidCallback = () => undefined;

  constructor(o: { expectLongid?: string, rejectKnown?: boolean, checkEncryption?: boolean, checkSigning?: boolean }) {
    this.expectedLongid = o.expectLongid || null;
    this.rejectKnown = o.rejectKnown === true;
    this.checkEncryption = o.checkEncryption === true;
    this.checkSigning = o.checkSigning === true;
  }

  public initPrvImportSrcForm = (acctEmail: string, parentTabId: string | null) => {
    $('input[type=radio][name=source]').off().change(function () {
      if ((this as HTMLInputElement).value === 'file') {
        $('.input_private_key').val('').change().prop('disabled', true);
        $('.source_paste_container').css('display', 'none');
        $('.source_paste_container .pass_phrase_needed').hide();
        $('#fineuploader_button > input').click();
      } else if ((this as HTMLInputElement).value === 'paste') {
        $('.input_private_key').val('').change().prop('disabled', false);
        $('.source_paste_container').css('display', 'block');
        $('.source_paste_container .pass_phrase_needed').hide();
      } else if ((this as HTMLInputElement).value === 'backup') {
        window.location.href = Env.urlCreate('/chrome/settings/setup.htm', { acctEmail, parentTabId, action: 'add_key' });
      }
    });
    $('.line.pass_phrase_needed .action_use_random_pass_phrase').click(Ui.event.handle(target => {
      $('.source_paste_container .input_passphrase').val(Pgp.password.random());
      $('.input_passphrase').attr('type', 'text');
      $('#e_rememberPassphrase').prop('checked', true);
    }));
    $('.input_private_key').change(Ui.event.handle(target => {
      let k = openpgp.key.readArmored($(target).val() as string).keys[0];
      $('.input_passphrase').val('');
      if (k && k.isPrivate() && k.isDecrypted()) {
        $('.line.pass_phrase_needed').show();
      } else {
        $('.line.pass_phrase_needed').hide();
      }
    }));
    let attach = new AttUI(() => ({ count: 100, size: 1024 * 1024, size_mb: 1 }));
    attach.initAttDialog('fineuploader', 'fineuploader_button');
    attach.setAttAddedCb(file => {
      let k;
      if (Value.is(Pgp.armor.headers('privateKey').begin).in(file.as_text())) {
        let firstPrv = Pgp.armor.detectBlocks(file.as_text()).blocks.filter(b => b.type === 'privateKey')[0];
        if (firstPrv) {
          k = openpgp.key.readArmored(firstPrv.content).keys[0];  // filter out all content except for the first encountered private key (GPGKeychain compatibility)
        }
      } else {
        k = openpgp.key.read(file.as_bytes()).keys[0];
      }
      if (typeof k !== 'undefined') {
        $('.input_private_key').val(k.armor()).change().prop('disabled', true);
        $('.source_paste_container').css('display', 'block');
      } else {
        $('.input_private_key').val('').change().prop('disabled', false);
        alert('Not able to read this key. Is it a valid PGP private key?');
        $('input[type=radio][name=source]').removeAttr('checked');
      }
    });
  }

  checkPrv = async (acctEmail: string, armored: string, passphrase: string): Promise<KeyImportUiCheckResult> => {
    let normalized = this.normalize('privateKey', armored);
    let decrypted = this.read('privateKey', normalized);
    let encrypted = this.read('privateKey', normalized);
    let longid = this.longid(decrypted);
    this.rejectIfNot('privateKey', decrypted);
    await this.rejectKnownIfSelected(acctEmail, decrypted);
    this.rejectIfDifferentFromSelectedLongid(longid);
    await this.decryptAndEncryptAsNeeded(decrypted, encrypted, passphrase);
    await this.checkEncryptionPrvIfSelected(decrypted, encrypted);
    await this.checkSigningIfSelected(decrypted);
    return { normalized, longid, passphrase, fingerprint: Pgp.key.fingerprint(decrypted)!, decrypted, encrypted }; // will have fp if had longid
  }

  checkPub = async (armored: string): Promise<string> => {
    let normalized = this.normalize('publicKey', armored);
    let parsed = this.read('publicKey', normalized);
    let longid = this.longid(parsed);
    await this.checkEncryptionPubIfSelected(normalized);
    return normalized;
  }

  private normalize = (type: KeyBlockType, armored: string) => {
    let headers = Pgp.armor.headers(type);
    let normalized = Pgp.key.normalize(armored);
    if (!normalized) {
      throw new UserAlert('There was an error processing this key, possibly due to bad formatting.\nPlease insert complete key, including "' + headers.begin + '" and "' + headers.end + '"');
    }
    return normalized;
  }

  private read = (type: KeyBlockType, normalized: string) => {
    let headers = Pgp.armor.headers(type);
    let k = openpgp.key.readArmored(normalized).keys[0];
    if (typeof k === 'undefined') {
      throw new UserAlert('Private key is not correctly formated. Please insert complete key, including "' + headers.begin + '" and "' + headers.end + '"');
    }
    return k;
  }

  private longid = (k: OpenPGP.key.Key) => {
    let longid = Pgp.key.longid(k);
    if (!longid) {
      throw new UserAlert('This key may not be compatible. Email human@flowcrypt.com and let us know which software created this key.\n\n(error: cannot get long_id)');
    }
    return longid;
  }

  private rejectIfNot = (type: KeyBlockType, k: OpenPGP.key.Key) => {
    let headers = Pgp.armor.headers(type);
    if (type === 'privateKey' && k.isPublic()) {
      throw new UserAlert('This was a public key. Please insert a private key instead. It\'s a block of text starting with "' + headers.begin + '"');
    }
    if (type === 'publicKey' && !k.isPublic()) {
      throw new UserAlert('This was a public key. Please insert a private key instead. It\'s a block of text starting with "' + headers.begin + '"');
    }
  }

  private rejectKnownIfSelected = async (acctEmail: string, k: OpenPGP.key.Key) => {
    if (this.rejectKnown) {
      let keyinfos = await Store.keysGet(acctEmail);
      let privateKeysLongids = keyinfos.map(ki => ki.longid);
      if (Value.is(Pgp.key.longid(k)!).in(privateKeysLongids)) {
        throw new UserAlert('This is one of your current keys, try another one.');
      }
    }
  }

  private rejectIfDifferentFromSelectedLongid = (longid: string) => {
    if (this.expectedLongid && longid !== this.expectedLongid) {
      throw new UserAlert(`Key does not match. Looking for key with KeyWords ${mnemonic(this.expectedLongid)} (${this.expectedLongid})`);
    }
  }

  private decryptAndEncryptAsNeeded = async (toDecrypt: OpenPGP.key.Key, toEncrypt: OpenPGP.key.Key, passphrase: string): Promise<void> => {
    if (!passphrase) {
      throw new UserAlert('Please enter a pass phrase to use with this key');
    }
    let decryptResult;
    try {
      if (toEncrypt.isDecrypted()) {
        await toEncrypt.encrypt(passphrase);
      }
      if (toDecrypt.isDecrypted()) {
        return;
      }
      decryptResult = await Pgp.key.decrypt(toDecrypt, [passphrase]);
    } catch (e) {
      throw new UserAlert(`This key is not supported by FlowCrypt yet. Please write at human@flowcrypt.com to add support soon. (decrypt error: ${String(e)})`);
    }
    if (!decryptResult) {
      this.onBadPassphrase();
      if (this.expectedLongid) {
        // tslint:disable-next-line:max-line-length
        throw new UserAlert('This is the right key! However, the pass phrase does not match. Please try a different pass phrase. Your original pass phrase might have been different then what you use now.');
      } else {
        throw new UserAlert('The pass phrase does not match. Please try a different pass phrase.');
      }
    }
  }

  private checkEncryptionPrvIfSelected = async (k: OpenPGP.key.Key, encrypted: OpenPGP.key.Key) => {
    if (this.checkEncryption && await k.getEncryptionKey() === null) {
      if (await k.verifyPrimaryKey() === openpgp.enums.keyStatus.no_self_cert || await Pgp.key.usableButExpired(k)) { // known issues - key can be fixed
        let e = new KeyCanBeFixed('');
        e.encrypted = encrypted;
        throw e;
      } else {
        throw new UserAlert('This looks like a valid key but it cannot be used for encryption. Please write at human@flowcrypt.com to see why is that.');
      }
    }
  }

  private checkEncryptionPubIfSelected = async (normalized: string) => {
    if (this.checkEncryption && !await Pgp.key.usable(normalized)) {
      throw new UserAlert('This public key looks correctly formatted, but cannot be used for encryption. Please write at human@flowcrypt.com. We\'ll see if there is a way to fix it.');
    }
  }

  private checkSigningIfSelected = async (k: OpenPGP.key.Key) => {
    if (this.checkSigning && await k.getSigningKey() === null) {
      throw new UserAlert('This looks like a valid key but it cannot be used for signing. Please write at human@flowcrypt.com to see why is that.');
    }
  }
}

export class AttUI {

  private templatePath = '/chrome/elements/shared/attach.template.htm';
  private getLimits: () => AttLimits;
  private attachedFiles: Dict<File> = {};
  private uploader: any = undefined;
  private attAddedCb: (r: any) => void;

  constructor(getLimits: () => AttLimits) {
    this.getLimits = getLimits;
  }

  initAttDialog = (elId: string, btnId: string) => {
    $('#qq-template').load(this.templatePath, () => {
      let config = {
        autoUpload: false,
        // debug: true,
        element: $('#' + elId).get(0),
        button: $('#' + btnId).get(0),
        dragAndDrop: {
          extraDropzones: $('#input_text'),
        },
        callbacks: {
          onSubmitted: (id: string, name: string) => Catch.try(() => this.processNewAtt(id, name))(),
          onCancel: (id: string) => Catch.try(() => this.cancelAtt(id))(),
        },
      };
      this.uploader = new qq.FineUploader(config);
    });
  }

  setAttAddedCb = (cb: (r: any) => void) => {
    this.attAddedCb = cb;
  }

  hasAtt = () => {
    return Object.keys(this.attachedFiles).length > 0;
  }

  getAttIds = () => {
    return Object.keys(this.attachedFiles);
  }

  collectAtt = async (id: string) => {
    let fileData = await this.readAttDataAsUint8(id);
    return new Att({ name: this.attachedFiles[id].name, type: this.attachedFiles[id].type, data: fileData });
  }

  collectAtts = async () => {
    let atts: Att[] = [];
    for (let id of Object.keys(this.attachedFiles)) {
      atts.push(await this.collectAtt(id));
    }
    return atts;
  }

  collectEncryptAtts = async (armoredPubkeys: string[], challenge: Pwd | null): Promise<Att[]> => {
    let atts: Att[] = [];
    for (let id of Object.keys(this.attachedFiles)) {
      let file = this.attachedFiles[id];
      let fileData = await this.readAttDataAsUint8(id);
      let encrypted = await Pgp.msg.encrypt(armoredPubkeys, null, challenge, fileData, file.name, false) as OpenPGP.EncryptBinaryResult;
      atts.push(new Att({ name: file.name.replace(/[^a-zA-Z\-_.0-9]/g, '_').replace(/__+/g, '_') + '.pgp', type: file.type, data: encrypted.message.packets.write() }));
    }
    return atts;
  }

  private cancelAtt = (id: string) => {
    delete this.attachedFiles[id];
  }

  private processNewAtt = (id: string, name: string) => {
    let limits = this.getLimits();
    if (limits.count && Object.keys(this.attachedFiles).length >= limits.count) {
      alert('Amount of attached files is limited to ' + limits.count);
      this.uploader.cancel(id);
    } else {
      let newFile = this.uploader.getFile(id);
      if (limits.size && this.getFileSizeSum() + newFile.size > limits.size) {
        this.uploader.cancel(id);
        if (typeof limits.oversize === 'function') {
          limits.oversize(this.getFileSizeSum() + newFile.size);
        } else {
          alert('Combined file size is limited to ' + limits.size_mb + 'MB');
        }
        return;
      }
      this.attachedFiles[id] = newFile;
      if (typeof this.attAddedCb === 'function') {
        this.collectAtt(id).then((a) => this.attAddedCb(a)).catch(Catch.rejection);
      }
    }
  }

  private getFileSizeSum = () => {
    let sum = 0;
    for (let file of Object.values(this.attachedFiles)) {
      sum += file.size;
    }
    return sum;
  }

  private readAttDataAsUint8 = (id: string): Promise<Uint8Array> => {
    return new Promise(resolve => {
      let reader = new FileReader();
      reader.onload = () => {
        resolve(new Uint8Array(reader.result as ArrayBuffer)); // that's what we're getting
      };
      reader.readAsArrayBuffer(this.attachedFiles[id]);
    });
  }

}