/**
 * Generate the local CA used by Legacy MITM capture.
 * Trust is deliberately a separate, explicit user action.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const certDir = process.env.WORKBENCH_CERT_DIR
  ? path.resolve(process.env.WORKBENCH_CERT_DIR)
  : path.join(__dirname, 'certs');
const certFile = path.join(certDir, 'cert.pem');
const keyFile = path.join(certDir, 'key.pem');
const opensslConf = path.join(certDir, 'openssl.cnf');

console.log('Setting up the Legacy MITM certificate...\n');
fs.mkdirSync(certDir, { recursive: true });

if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
  console.log(`Certificate already exists: ${certFile}`);
  process.exit(0);
}

const config = `[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_ext

[dn]
CN = Agent Trace Workbench Local MITM CA

[v3_ext]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign, digitalSignature
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
`;

try {
  fs.writeFileSync(opensslConf, config, { mode: 0o600 });
  const result = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', keyFile,
    '-out', certFile,
    '-days', '365',
    '-nodes',
    '-config', opensslConf,
  ], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`OpenSSL exited with code ${result.status}`);
  try { fs.chmodSync(keyFile, 0o600); } catch {}

  console.log('\nCertificate generated. Review it before adding it to a trust store:');
  console.log(`  Certificate: ${certFile}`);
  console.log(`  Private key: ${keyFile}`);
  console.log('\nTrust is not changed automatically. If you enable Legacy MITM:');
  if (process.platform === 'win32') {
    console.log(`  Windows (administrator): certutil -addstore -f Root "${certFile}"`);
    console.log(`  Remove later: certutil -delstore Root "Agent Trace Workbench Local MITM CA"`);
  } else if (process.platform === 'darwin') {
    console.log(`  macOS: sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certFile}"`);
    console.log('  Remove it later in Keychain Access.');
  } else {
    console.log(`  Linux: copy "${certFile}" to your distribution trust directory, then update CA certificates.`);
    console.log('  Remove that copied certificate and update CA certificates again when finished.');
  }
  console.log('\nOnly trust this certificate while you need local capture. Never share the private key.');
} catch (error) {
  console.error(`Certificate generation failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { fs.unlinkSync(opensslConf); } catch {}
}
