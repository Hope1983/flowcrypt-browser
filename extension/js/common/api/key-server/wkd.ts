/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */

'use strict';

import { Api } from './../shared/api.js';
import { ApiErr } from '../shared/api-error.js';
import { opgp } from '../../core/crypto/pgp/openpgpjs-custom.js';
import { Buf } from '../../core/buf.js';
import { PubkeySearchResult } from './../pub-lookup.js';
import { KeyUtil } from '../../core/crypto/key.js';

// tslint:disable:no-null-keyword
// tslint:disable:no-direct-ajax

export class Wkd extends Api {

  // https://datatracker.ietf.org/doc/draft-koch-openpgp-webkey-service/?include_text=1
  // https://www.sektioneins.de/en/blog/18-11-23-gnupg-wkd.html
  // https://metacode.biz/openpgp/web-key-directory

  public port: number | undefined;

  constructor(private myOwnDomain: string) {
    super();
  }

  public lookupEmail = async (email: string): Promise<PubkeySearchResult> => {
    const parts = email.split('@');
    if (parts.length !== 2) {
      return { pubkey: null, pgpClient: null };
    }
    const [user, recipientDomain] = parts;
    if (!user || !recipientDomain) {
      return { pubkey: null, pgpClient: null };
    }
    if (!opgp) {
      // pgp_block.htm does not have openpgp loaded
      // the particular usecase (auto-loading pubkeys to verify signatures) is not that important,
      //    the user typically gets the key loaded from composing anyway
      // the proper fix would be to run encodeZBase32 through background scripts
      return { pubkey: null, pgpClient: null };
    }
    const directDomain = recipientDomain.toLowerCase();
    const advancedDomainPrefix = (directDomain === 'localhost') ? '' : 'openpgpkey.';
    const hu = opgp.util.encodeZBase32(await opgp.crypto.hash.digest(opgp.enums.hash.sha1, Buf.fromUtfStr(user.toLowerCase())));
    const directHost = (typeof this.port === 'undefined') ? directDomain : `${directDomain}:${this.port}`;
    const advancedHost = `${advancedDomainPrefix}${directHost}`;
    const userPart = `hu/${hu}?l=${encodeURIComponent(user)}`;
    const advancedUrl = `https://${advancedHost}/.well-known/openpgpkey/${directDomain}`;
    const directUrl = `https://${directHost}/.well-known/openpgpkey`;
    let response = await this.urlLookup(advancedUrl, userPart);
    if (!response.buf && response.hasPolicy) {
      return { pubkey: null, pgpClient: null }; // do not retry direct if advanced had a policy file
    }
    if (!response.buf) {
      response = await this.urlLookup(directUrl, userPart);
    }
    if (!response.buf) {
      return { pubkey: null, pgpClient: null }; // do not retry direct if advanced had a policy file
    }
    const { keys, errs } = await KeyUtil.readMany(response.buf);
    if (errs.length) {
      return { pubkey: null, pgpClient: null };
    }
    const key = keys.find(key => key.usableForEncryption && key.emails.some(x => x.toLowerCase() === email.toLowerCase()));
    if (!key) {
      return { pubkey: null, pgpClient: null };
    }
    // if recipient uses same domain, we assume they use flowcrypt
    const pgpClient = this.myOwnDomain === recipientDomain ? 'flowcrypt' : 'pgp-other';
    try {
      const pubkey = KeyUtil.armor(key);
      return { pubkey, pgpClient };
    } catch (e) {
      return { pubkey: null, pgpClient: null };
    }
  }

  private urlLookup = async (methodUrlBase: string, userPart: string): Promise<{ hasPolicy: boolean, buf?: Buf }> => {
    try {
      await Wkd.download(`${methodUrlBase}/policy`, undefined, 4);
    } catch (e) {
      return { hasPolicy: false };
    }
    try {
      const buf = await Wkd.download(`${methodUrlBase}/${userPart}`, undefined, 4);
      if (buf.length) {
        console.info(`Loaded WKD url ${methodUrlBase}/${userPart} and will try to extract Public Keys`);
      }
      return { hasPolicy: true, buf };
    } catch (e) {
      if (!ApiErr.isNotFound(e)) {
        console.info(`Wkd.lookupEmail error retrieving key: ${String(e)}`);
      }
      return { hasPolicy: true };
    }
  }

}
