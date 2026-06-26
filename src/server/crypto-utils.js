// ClipSync — 服务端加密工具模块
// ECDH 密钥协商 + AES-256-GCM 加解密
const crypto = require('crypto');

const AES_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ECDH_CURVE = 'prime256v1';

// 生成 256 位 AES 主密钥
function generateMasterKey() {
  return crypto.randomBytes(32);
}

// 生成 ECDH 密钥对（临时，每次密钥协商使用）
function generateECDHKeyPair() {
  const ecdh = crypto.createECDH(ECDH_CURVE);
  ecdh.generateKeys();
  return ecdh;
}

// 从 ECDH 共享密钥派生 AES 密钥（SHA-256 哈希）
function deriveSharedKey(ecdh, peerPublicKey) {
  const sharedSecret = ecdh.computeSecret(peerPublicKey);
  return crypto.createHash('sha256').update(sharedSecret).digest();
}

// AES-256-GCM 加密，返回 base64
// 格式：iv + ciphertext + authTag（与 Web Crypto API 一致）
function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, authTag]).toString('base64');
}

// AES-256-GCM 解密，输入 base64 密文（格式同上）
function decrypt(ciphertextBase64, key) {
  const buf = Buffer.from(ciphertextBase64, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(AES_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// 加密 JSON 对象，返回 { encrypted: true, data: "..." }
function encryptJSON(obj, key) {
  const data = encrypt(JSON.stringify(obj), key);
  return { encrypted: true, data };
}

module.exports = {
  generateMasterKey,
  generateECDHKeyPair,
  deriveSharedKey,
  encrypt,
  decrypt,
  encryptJSON
};
