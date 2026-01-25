/**
 * MCPB Signature Verification
 *
 * Extracts and verifies PKCS#7 code signatures from MCPB files.
 * Adapted from mcpb-reference implementation.
 */

import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import forge from 'node-forge';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import type { McpbSignatureInfo, SignatureStatus } from './types.js';

const execFileAsync = promisify(execFile);

// Signature block markers
const SIGNATURE_HEADER = 'MCPB_SIG_V1';
const SIGNATURE_FOOTER = 'MCPB_SIG_END';

/**
 * Extract signature block from MCPB file content
 */
export function extractSignatureBlock(fileContent: Buffer): {
  originalContent: Buffer;
  pkcs7Signature?: Buffer;
} {
  // Look for signature footer at the end
  const footerBytes = Buffer.from(SIGNATURE_FOOTER, 'utf-8');
  const footerIndex = fileContent.lastIndexOf(footerBytes);

  if (footerIndex === -1) {
    return { originalContent: fileContent };
  }

  // Look for signature header before footer
  const headerBytes = Buffer.from(SIGNATURE_HEADER, 'utf-8');
  let headerIndex = -1;

  // Search backwards from footer
  for (let i = footerIndex - 1; i >= 0; i--) {
    if (fileContent.slice(i, i + headerBytes.length).equals(headerBytes)) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    return { originalContent: fileContent };
  }

  // Extract original content (everything before signature block)
  const originalContent = fileContent.slice(0, headerIndex);

  // Parse signature block
  let offset = headerIndex + headerBytes.length;

  try {
    // Read PKCS#7 signature length
    const sigLength = fileContent.readUInt32LE(offset);
    offset += 4;

    // Read PKCS#7 signature
    const pkcs7Signature = fileContent.slice(offset, offset + sigLength);

    return {
      originalContent,
      pkcs7Signature,
    };
  } catch {
    return { originalContent: fileContent };
  }
}

/**
 * Verify certificate chain against OS trust store
 */
async function verifyCertificateChain(
  certificate: Buffer,
  intermediates?: Buffer[]
): Promise<boolean> {
  let tempDir: string | null = null;

  try {
    tempDir = await mkdtemp(join(tmpdir(), 'mcpb-verify-'));
    const certChainPath = join(tempDir, 'chain.pem');
    const certChain = [certificate, ...(intermediates || [])].join('\n');
    await writeFile(certChainPath, certChain);

    // Platform-specific verification
    if (process.platform === 'darwin') {
      try {
        await execFileAsync('security', [
          'verify-cert',
          '-c',
          certChainPath,
          '-p',
          'codeSign',
        ]);
        return true;
      } catch {
        return false;
      }
    } else if (process.platform === 'win32') {
      const psCommand = `
        $ErrorActionPreference = 'Stop'
        $certCollection = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2Collection
        $certCollection.Import('${certChainPath.replace(/\\/g, '\\\\')}')

        if ($certCollection.Count -eq 0) {
          Write-Error 'No certificates found'
          exit 1
        }

        $leafCert = $certCollection[0]
        $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain

        # Enable revocation checking
        $chain.ChainPolicy.RevocationMode = 'Online'
        $chain.ChainPolicy.RevocationFlag = 'EntireChain'
        $chain.ChainPolicy.UrlRetrievalTimeout = New-TimeSpan -Seconds 30

        # Add code signing application policy
        $codeSignOid = New-Object System.Security.Cryptography.Oid '1.3.6.1.5.5.7.3.3'
        $chain.ChainPolicy.ApplicationPolicy.Add($codeSignOid)

        # Add intermediate certificates to extra store
        for ($i = 1; $i -lt $certCollection.Count; $i++) {
          [void]$chain.ChainPolicy.ExtraStore.Add($certCollection[$i])
        }

        # Build and validate chain
        $result = $chain.Build($leafCert)

        if ($result) {
          'Valid'
        } else {
          $chain.ChainStatus | ForEach-Object {
            Write-Error "$($_.Status): $($_.StatusInformation)"
          }
          exit 1
        }
      `.trim();

      try {
        const { stdout } = await execFileAsync('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          psCommand,
        ]);
        return stdout.includes('Valid');
      } catch {
        return false;
      }
    } else {
      // Linux: Use openssl
      try {
        await execFileAsync('openssl', [
          'verify',
          '-purpose',
          'codesigning',
          '-CApath',
          '/etc/ssl/certs',
          certChainPath,
        ]);
        return true;
      } catch {
        return false;
      }
    }
  } catch {
    return false;
  } finally {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Verify MCPB file signature
 *
 * @param mcpbPath Path to the MCPB file
 * @returns Signature information including verification status
 */
export async function verifySignature(mcpbPath: string): Promise<McpbSignatureInfo> {
  try {
    const fileContent = readFileSync(mcpbPath);

    // Find and extract signature block
    const { originalContent, pkcs7Signature } = extractSignatureBlock(fileContent);

    if (!pkcs7Signature) {
      return { status: 'unsigned' };
    }

    // Parse PKCS#7 signature
    const asn1 = forge.asn1.fromDer(pkcs7Signature.toString('binary'));
    const p7Message = forge.pkcs7.messageFromAsn1(asn1);

    // Verify it's signed data
    if (
      !('type' in p7Message) ||
      p7Message.type !== forge.pki.oids.signedData
    ) {
      return { status: 'unsigned' };
    }

    // Type assertion for signed data
    const p7 = p7Message as unknown as forge.pkcs7.PkcsSignedData & {
      signerInfos: Array<{
        authenticatedAttributes: Array<{
          type: string;
          value: unknown;
        }>;
      }>;
      verify: (options?: { authenticatedAttributes?: boolean }) => boolean;
    };

    // Extract certificates from PKCS#7
    const certificates = p7.certificates || [];
    if (certificates.length === 0) {
      return { status: 'unsigned' };
    }

    // Get the signing certificate (first one)
    const signingCert = certificates[0];

    // Verify PKCS#7 signature
    // Convert Node.js Buffer to binary string for node-forge
    const contentBuf = forge.util.createBuffer(originalContent.toString('binary'));

    try {
      p7.verify({ authenticatedAttributes: true });

      // Also verify the content matches
      const signerInfos = p7.signerInfos;
      const signerInfo = signerInfos?.[0];
      if (signerInfo) {
        const md = forge.md.sha256.create();
        md.update(contentBuf.getBytes());
        const digest = md.digest().getBytes();

        // Find the message digest attribute
        let messageDigest = null;
        for (const attr of signerInfo.authenticatedAttributes) {
          if (attr.type === forge.pki.oids.messageDigest) {
            messageDigest = attr.value;
            break;
          }
        }

        if (!messageDigest || messageDigest !== digest) {
          return { status: 'unsigned' };
        }
      }
    } catch {
      return { status: 'unsigned' };
    }

    // Convert forge certificate to PEM for OS verification
    const certPem = forge.pki.certificateToPem(signingCert);
    const intermediatePems = certificates
      .slice(1)
      .map((cert) => Buffer.from(forge.pki.certificateToPem(cert)));

    // Verify certificate chain against OS trust store
    const chainValid = await verifyCertificateChain(
      Buffer.from(certPem),
      intermediatePems
    );

    // Extract certificate info
    const isSelfSigned =
      signingCert.issuer.getField('CN')?.value ===
      signingCert.subject.getField('CN')?.value;

    // Determine status
    let status: SignatureStatus;
    if (!chainValid) {
      status = isSelfSigned ? 'self-signed' : 'unsigned';
    } else {
      status = isSelfSigned ? 'self-signed' : 'signed';
    }

    return {
      status,
      publisher: signingCert.subject.getField('CN')?.value || 'Unknown',
      issuer: signingCert.issuer.getField('CN')?.value || 'Unknown',
      valid_from: signingCert.validity.notBefore.toISOString(),
      valid_to: signingCert.validity.notAfter.toISOString(),
      fingerprint: forge.md.sha256
        .create()
        .update(
          forge.asn1.toDer(forge.pki.certificateToAsn1(signingCert)).getBytes()
        )
        .digest()
        .toHex(),
    };
  } catch (error) {
    // If verification fails for any reason, treat as unsigned
    return { status: 'unsigned' };
  }
}
