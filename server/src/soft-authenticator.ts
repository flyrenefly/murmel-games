import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from 'node:crypto';

/**
 * A software passkey for tests: answers navigator.credentials.create/get like a platform authenticator
 * (ES256, attestation "none", user present and verified). Produces the JSON the browser library sends.
 */

type Cbor = number | string | Uint8Array | CborMap | CborRecord;
interface CborMap extends Map<Cbor, Cbor> {}
interface CborRecord {
  [key: string]: Cbor;
}

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

/** Minimal CBOR encoder (integers, text, bytes, maps) – enough for attestation objects and COSE keys. */
export function cbor(v: Cbor): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') {
    const b = Buffer.from(v, 'utf8');
    return Buffer.concat([head(3, b.length), b]);
  }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), v]);
  const entries: [Cbor, Cbor][] = v instanceof Map ? [...v] : Object.entries(v);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

const b64 = (b: Uint8Array | string) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

export class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly key: KeyObject;
  private readonly publicJwk: { x: string; y: string };
  private counter = 0;
  readonly rpId: string;
  readonly origin: string;

  constructor(origin: string) {
    this.origin = origin;
    this.rpId = new URL(origin).hostname;
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.key = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.publicJwk = { x: jwk.x!, y: jwk.y! };
  }

  private clientData(type: string, challenge: string, origin: string): string {
    return JSON.stringify({ type, challenge, origin, crossOrigin: false });
  }

  /** Answer to registration options (navigator.credentials.create). */
  create(options: { challenge: string }, origin = this.origin) {
    const cose = cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(this.publicJwk.x, 'base64url')], [-3, Buffer.from(this.publicJwk.y, 'base64url')]]));
    const idLen = Buffer.from([this.credentialId.length >> 8, this.credentialId.length & 255]);
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([0x45]), // UP | UV | AT
      Buffer.alloc(4), // counter 0
      Buffer.alloc(16), // AAGUID
      idLen,
      this.credentialId,
      cose,
    ]);
    const clientDataJSON = this.clientData('webauthn.create', options.challenge, origin);
    return {
      id: b64(this.credentialId),
      rawId: b64(this.credentialId),
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64(clientDataJSON),
        attestationObject: b64(cbor({ fmt: 'none', attStmt: {}, authData })),
        transports: ['internal'],
      },
    };
  }

  /** Answer to authentication options (navigator.credentials.get). */
  get(options: { challenge: string }, origin = this.origin) {
    this.counter++;
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const authData = Buffer.concat([sha256(this.rpId), Buffer.from([0x05]), count]); // UP | UV
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, origin);
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), this.key); // DER
    return {
      id: b64(this.credentialId),
      rawId: b64(this.credentialId),
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authData),
        signature: b64(signature),
        userHandle: b64('user'),
      },
    };
  }
}
