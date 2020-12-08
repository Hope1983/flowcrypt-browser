/* ©️ 2016 - present FlowCrypt a.s. Limitations apply. Contact human@flowcrypt.com */
import * as forge from 'node-forge';
import { Key, KeyUtil } from '../key.js';
import { Str } from '../../common.js';
import { UnreportableError } from '../../../platform/catch.js';

export class SmimeKey {

  public static parse = async (text: string): Promise<Key> => {
    const certificate = forge.pki.certificateFromPem(text);
    const email = (certificate.subject.getField('CN') as { value: string }).value;
    const normalizedEmail = Str.parseEmail(email).email;
    if (!normalizedEmail) {
      throw new UnreportableError(`This S/MIME x.509 certificate has an invalid recipient email: ${email}`);
    }
    const key = {
      type: 'x509',
      id: certificate.serialNumber.toUpperCase(),
      allIds: [certificate.serialNumber.toUpperCase()],
      usableForEncryption: SmimeKey.isEmailCertificate(certificate),
      usableForSigning: SmimeKey.isEmailCertificate(certificate),
      usableForEncryptionButExpired: false,
      usableForSigningButExpired: false,
      emails: [normalizedEmail],
      identities: [normalizedEmail],
      created: SmimeKey.dateToNumber(certificate.validity.notBefore),
      lastModified: SmimeKey.dateToNumber(certificate.validity.notBefore),
      expiration: SmimeKey.dateToNumber(certificate.validity.notAfter),
      fullyDecrypted: false,
      fullyEncrypted: false,
      isPublic: true,
      isPrivate: true,
    } as Key;
    (key as unknown as { raw: string }).raw = text;
    return key;
  }

  public static parseBinary = async (buffer: Uint8Array, password: string): Promise<Key> => {
    const bytes = String.fromCharCode.apply(undefined, new Uint8Array(buffer) as unknown as number[]) as string;
    const p12Asn1 = forge.asn1.fromDer(bytes);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
    const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!bags) {
      throw new Error('No user certificate found.');
    }
    const bag = bags[forge.pki.oids.certBag];
    if (!bag) {
      throw new Error('No user certificate found.');
    }
    const certificate = bag[0]?.cert;
    if (!certificate) {
      throw new Error('No user certificate found.');
    }
    const email = (certificate.subject.getField('CN') as { value: string }).value;
    const normalizedEmail = Str.parseEmail(email).email;
    if (!normalizedEmail) {
      throw new UnreportableError(`This S/MIME x.509 certificate has an invalid recipient email: ${email}`);
    }
    const key = {
      type: 'x509',
      id: certificate.serialNumber.toUpperCase(),
      allIds: [certificate.serialNumber.toUpperCase()],
      usableForEncryption: SmimeKey.isEmailCertificate(certificate),
      usableForSigning: SmimeKey.isEmailCertificate(certificate),
      usableForEncryptionButExpired: false,
      usableForSigningButExpired: false,
      emails: [normalizedEmail],
      identities: [normalizedEmail],
      created: SmimeKey.dateToNumber(certificate.validity.notBefore),
      lastModified: SmimeKey.dateToNumber(certificate.validity.notBefore),
      expiration: SmimeKey.dateToNumber(certificate.validity.notAfter),
      fullyDecrypted: false,
      fullyEncrypted: false,
      isPublic: true,
      isPrivate: true,
    } as Key;
    (key as unknown as { raw: string }).raw = `------- BEGIN PRIVATE ENCRYPTED PKCS#12 FILE -------
${forge.util.encode64(bytes)}
------- END PRIVATE ENCRYPTED PKCS#12 FILE -------` as string;
    return key;
  }

  /**
   * @param data: an already encoded plain mime message
   */
  public static encryptMessage = async ({ pubkeys, data }: { pubkeys: Key[], data: Uint8Array }): Promise<{ data: Uint8Array, type: 'smime' }> => {
    const p7 = forge.pkcs7.createEnvelopedData();
    for (const pubkey of pubkeys) {
      p7.addRecipient(forge.pki.certificateFromPem(KeyUtil.armor(pubkey)));
    }
    p7.content = forge.util.createBuffer(data);
    p7.encrypt();
    const derBuffer = forge.asn1.toDer(p7.toAsn1()).getBytes();
    const arr = [];
    for (let i = 0, j = derBuffer.length; i < j; ++i) {
      arr.push(derBuffer.charCodeAt(i));
    }
    return { data: new Uint8Array(arr), type: 'smime' };
  }

  private static isEmailCertificate = (certificate: forge.pki.Certificate) => {
    const eku = certificate.getExtension('extKeyUsage');
    if (!eku) {
      return false;
    }
    return !!(eku as { emailProtection: boolean }).emailProtection;
  }

  private static dateToNumber = (date: Date): undefined | number => {
    if (!date) {
      return;
    }
    return date.getTime();
  }

}
