import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import forge from 'node-forge';

const { pki, asn1, md } = forge;

/*
 * HTTPS for the prototype, without a public domain.
 *
 * A small certificate authority is made once per machine and kept in .certs/.
 * It signs the server's certificate, which is reissued whenever this
 * machine's LAN address changes or the certificate nears expiry.
 *
 * Until the CA is trusted, browsers warn once, exactly as with a plain
 * self-signed certificate. Trusting it on a phone (see /connect) removes the
 * warning and fixes what the warning silently breaks: iOS will not fetch the
 * home-screen icon from an untrusted server, and shows a letter tile instead.
 * Trust is per CA, so it survives the address changing.
 *
 * The CA is name-constrained to localhost and private network addresses. A
 * phone that trusts it will not accept it for any public website, so a leaked
 * key could not be used to impersonate one.
 */

export const CA_PATH = '/florascan-ca.crt';

const PERMITTED_DNS = ['localhost', 'local'];
const PERMITTED_IP = [
  ['10.0.0.0', '255.0.0.0'],
  ['172.16.0.0', '255.240.0.0'], // includes the iPhone hotspot range, 172.20.10.x
  ['192.168.0.0', '255.255.0.0'],
  ['127.0.0.0', '255.0.0.0'],
];

const toInt = (ip) => ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
const permittedIp = (ip) => PERMITTED_IP.some(([base, mask]) => ((toInt(ip) & toInt(mask)) >>> 0) === toInt(base));
const ipBytes = (ip) => String.fromCharCode(...ip.split('.').map(Number));

/** A positive serial number with enough randomness to never repeat. */
function serial() {
  const b = crypto.randomBytes(16);
  b[0] &= 0x7f;
  return b.toString('hex');
}

function validity(cert, days) {
  const from = new Date(Date.now() - 24 * 3600 * 1000); // tolerate a phone clock running slow
  cert.validity.notBefore = from;
  cert.validity.notAfter = new Date(from.getTime() + days * 24 * 3600 * 1000);
}

/** RFC 5280 NameConstraints, which node-forge has no builder for. */
function nameConstraints() {
  const C = asn1.Class;
  const subtree = (name) => asn1.create(C.UNIVERSAL, asn1.Type.SEQUENCE, true, [name]);
  const permitted = [
    ...PERMITTED_DNS.map((d) => subtree(asn1.create(C.CONTEXT_SPECIFIC, 2, false, d))),
    ...PERMITTED_IP.map(([base, mask]) => subtree(asn1.create(C.CONTEXT_SPECIFIC, 7, false, ipBytes(base) + ipBytes(mask)))),
  ];
  return {
    id: '2.5.29.30',
    critical: true,
    value: asn1.create(C.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(C.CONTEXT_SPECIFIC, 0, true, permitted),
    ]),
  };
}

function createCa() {
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  validity(cert, 3650);
  // UTF8String: forge defaults to PrintableString, which cannot hold common
  // hostname characters such as "_", and Chrome rejects the whole chain.
  const subject = [
    { name: 'commonName', value: `FloraScan local CA (${os.hostname()})`, valueTagClass: asn1.Type.UTF8 },
    { name: 'organizationName', value: 'FloraScan prototype', valueTagClass: asn1.Type.UTF8 },
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
    nameConstraints(),
  ]);
  cert.sign(keys.privateKey, md.sha256.create());
  return { key: pki.privateKeyToPem(keys.privateKey), cert: pki.certificateToPem(cert) };
}

/**
 * The server certificate. Kept within Apple's rules for TLS certificates
 * (iOS 13+): SHA-256, RSA 2048, serverAuth usage, names in the SAN, and a
 * lifetime well under 825 days.
 */
function createLeaf(ca, ips) {
  const caCert = pki.certificateFromPem(ca.cert);
  const caKey = pki.privateKeyFromPem(ca.key);
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  validity(cert, 397);
  cert.setSubject([{ name: 'commonName', value: 'localhost', valueTagClass: asn1.Type.UTF8 }]);
  cert.setIssuer(caCert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...ips.map((ip) => ({ type: 7, ip }))] },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes() },
  ]);
  cert.sign(caKey, md.sha256.create());
  return { key: pki.privateKeyToPem(keys.privateKey), cert: pki.certificateToPem(cert) };
}

/** Why an existing server certificate has to be reissued, or null if it is fine. */
function staleReason(leafPem, caPem, ips) {
  let leaf;
  let ca;
  try {
    leaf = new crypto.X509Certificate(leafPem);
    ca = new crypto.X509Certificate(caPem);
  } catch {
    return 'unreadable';
  }
  if (!leaf.checkIssued(ca) || !leaf.verify(ca.publicKey)) return 'not signed by the local CA';
  if (new Date(leaf.validTo).getTime() - Date.now() < 30 * 24 * 3600 * 1000) return 'expiring';
  const san = leaf.subjectAltName || '';
  const missing = ips.filter((ip) => !san.includes('IP Address:' + ip));
  if (missing.length) return 'new network address ' + missing.join(', ');
  return null;
}

const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);

/**
 * Key and certificate for the HTTPS server, creating or reissuing them as
 * needed. `addresses` are this machine's IPv4 addresses; only private ones go
 * into the certificate, since the CA may not vouch for anything else.
 */
export function tlsOptions(dir, addresses) {
  fs.mkdirSync(dir, { recursive: true });
  const f = {
    caKey: `${dir}/ca-key.pem`, caCert: `${dir}/ca.pem`,
    key: `${dir}/key.pem`, cert: `${dir}/cert.pem`,
  };
  const ips = [...new Set(['127.0.0.1', ...addresses])].filter(permittedIp);

  let ca = { key: read(f.caKey), cert: read(f.caCert) };
  if (!ca.key || !ca.cert) {
    ca = createCa();
    fs.writeFileSync(f.caKey, ca.key, { mode: 0o600 });
    fs.writeFileSync(f.caCert, ca.cert);
  }

  let leaf = { key: read(f.key), cert: read(f.cert) };
  const reason = !leaf.key || !leaf.cert ? 'missing' : staleReason(leaf.cert, ca.cert, ips);
  if (reason) {
    leaf = createLeaf(ca, ips);
    fs.writeFileSync(f.key, leaf.key, { mode: 0o600 });
    fs.writeFileSync(f.cert, leaf.cert);
  }

  return { key: leaf.key, cert: leaf.cert, ca: ca.cert, reissued: reason };
}

/** The CA certificate in DER form, which is what a phone installs. */
export function caDer(caPem) {
  return Buffer.from(new crypto.X509Certificate(caPem).raw);
}
