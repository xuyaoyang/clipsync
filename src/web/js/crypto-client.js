// ClipSync — 浏览器端加密客户端
// ECDH 密钥协商 + AES-256-GCM 加解密（Web Crypto API）
// 仅在安全上下文（HTTPS / localhost）下可用，否则降级为明文传输
const CryptoClient = (() => {
  const AES_ALGORITHM = 'AES-GCM';
  const IV_LENGTH = 12;
  const ECDH_CURVE = 'P-256';

  let masterKey = null;
  let masterKeyRaw = null;
  let ecdhKeyPair = null;
  let subtle = null; // crypto.subtle 引用

  // 检测 Web Crypto 是否可用
  function checkAvailability() {
    if (!window.crypto || !window.crypto.subtle) {
      console.warn('[Crypto] 当前环境不支持 Web Crypto API（非安全上下文），将使用明文传输');
      return false;
    }
    subtle = window.crypto.subtle;
    return true;
  }

  // ============ 初始化 ============

  async function init() {
    if (!checkAvailability()) return false;

    // 尝试从 localStorage 恢复主密钥
    const stored = localStorage.getItem('masterKey');
    if (stored) {
      try {
        masterKeyRaw = base64ToArrayBuffer(stored);
        masterKey = await importAESKey(masterKeyRaw);
        console.log('[Crypto] 主密钥已恢复');
        return true;
      } catch (e) {
        console.warn('[Crypto] 密钥恢复失败，将重新协商:', e.message);
        localStorage.removeItem('masterKey');
      }
    }

    await ensureECDHKeyPair();
    return false;
  }

  function hasKey() {
    return masterKey !== null;
  }

  function isAvailable() {
    return subtle !== null;
  }

  // ============ ECDH 密钥协商 ============

  async function ensureECDHKeyPair() {
    if (!subtle) throw new Error('Web Crypto 不可用');
    const stored = localStorage.getItem('ecdhPrivateKey');
    if (stored) {
      try {
        ecdhKeyPair = await importECDHKeyPair(stored);
        return;
      } catch (e) {
        console.warn('[Crypto] ECDH 密钥恢复失败，重新生成');
      }
    }
    ecdhKeyPair = await subtle.generateKey(
      { name: 'ECDH', namedCurve: ECDH_CURVE },
      true,
      ['deriveBits']
    );
    const jwk = await subtle.exportKey('jwk', ecdhKeyPair.privateKey);
    localStorage.setItem('ecdhPrivateKey', JSON.stringify(jwk));
  }

  async function importECDHKeyPair(jwkStr) {
    const jwk = JSON.parse(jwkStr);
    const privateKey = await subtle.importKey(
      'jwk', jwk,
      { name: 'ECDH', namedCurve: ECDH_CURVE },
      true, ['deriveBits']
    );
    return { privateKey, publicKey: null };
  }

  async function getPublicKeyBase64() {
    if (!subtle) return '';
    try {
      await ensureECDHKeyPair();
      // 需要重新获取公钥：从私钥 JWK 计算
      const jwk = JSON.parse(localStorage.getItem('ecdhPrivateKey'));
      const privateKey = await subtle.importKey(
        'jwk', jwk,
        { name: 'ECDH', namedCurve: ECDH_CURVE },
        true, ['deriveBits']
      );
      // 导出私钥对应的公钥需要特殊处理
      // 把 jwk 中私钥的 x,y 提取为公钥 jwk
      const pubJwk = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
      const pubKey = await subtle.importKey(
        'jwk', pubJwk,
        { name: 'ECDH', namedCurve: ECDH_CURVE },
        true, []
      );
      const raw = await subtle.exportKey('raw', pubKey);
      ecdhKeyPair = { privateKey, publicKey: pubKey };
      return arrayBufferToBase64(raw);
    } catch (e) {
      console.warn('[Crypto] 获取公钥失败:', e.message);
      return '';
    }
  }

  // 接收服务端的临时公钥，协商出主密钥
  async function negotiateMasterKey(serverPubKeyBase64) {
    await ensureECDHKeyPair();
    const jwk = JSON.parse(localStorage.getItem('ecdhPrivateKey'));
    const privateKey = await subtle.importKey(
      'jwk', jwk,
      { name: 'ECDH', namedCurve: ECDH_CURVE },
      true, ['deriveBits']
    );
    const serverPubKey = await subtle.importKey(
      'raw', base64ToArrayBuffer(serverPubKeyBase64),
      { name: 'ECDH', namedCurve: ECDH_CURVE },
      false, []
    );
    const sharedBits = await subtle.deriveBits(
      { name: 'ECDH', public: serverPubKey },
      privateKey,
      256
    );
    const sharedKey = await subtle.digest('SHA-256', sharedBits);
    return sharedKey;
  }

  async function setMasterKeyFromNegotiation(serverPubKeyBase64, encryptedMasterKeyBase64) {
    const tempKey = await negotiateMasterKey(serverPubKeyBase64);
    const tempCryptoKey = await importAESKey(tempKey);
    const masterKeyBase64 = await decryptRaw(encryptedMasterKeyBase64, tempCryptoKey);

    masterKeyRaw = base64ToArrayBuffer(masterKeyBase64);
    masterKey = await importAESKey(masterKeyRaw);
    localStorage.setItem('masterKey', masterKeyBase64);
    console.log('[Crypto] 主密钥协商完成');
  }

  // ============ AES 加解密 ============

  async function importAESKey(rawKey) {
    return subtle.importKey(
      'raw', rawKey,
      { name: AES_ALGORITHM, length: 256 },
      false, ['encrypt', 'decrypt']
    );
  }

  async function encrypt(plaintext) {
    if (!masterKey) throw new Error('密钥未就绪');
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await subtle.encrypt(
      { name: AES_ALGORITHM, iv, tagLength: 128 },
      masterKey, encoded
    );
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return arrayBufferToBase64(combined.buffer);
  }

  async function decrypt(encryptedBase64) {
    if (!masterKey) throw new Error('密钥未就绪');
    const buf = base64ToArrayBuffer(encryptedBase64);
    const iv = new Uint8Array(buf, 0, IV_LENGTH);
    const ciphertext = new Uint8Array(buf, IV_LENGTH);
    const decrypted = await subtle.decrypt(
      { name: AES_ALGORITHM, iv, tagLength: 128 },
      masterKey, ciphertext
    );
    return new TextDecoder().decode(decrypted);
  }

  async function decryptRaw(encryptedBase64, tempKey) {
    const buf = base64ToArrayBuffer(encryptedBase64);
    const iv = new Uint8Array(buf, 0, IV_LENGTH);
    const ciphertext = new Uint8Array(buf, IV_LENGTH);
    const decrypted = await subtle.decrypt(
      { name: AES_ALGORITHM, iv, tagLength: 128 },
      tempKey, ciphertext
    );
    return arrayBufferToBase64(decrypted);
  }

  // ============ 数据包装 ============

  async function encryptJSON(obj) {
    const data = await encrypt(JSON.stringify(obj));
    return { encrypted: true, data };
  }

  async function decryptJSON(encryptedObj) {
    if (!encryptedObj || !encryptedObj.encrypted) return encryptedObj;
    const json = await decrypt(encryptedObj.data);
    return JSON.parse(json);
  }

  // ============ 工具函数 ============

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  return { init, hasKey, isAvailable, getPublicKeyBase64, setMasterKeyFromNegotiation, encrypt, decrypt, encryptJSON, decryptJSON, exportKey: () => masterKeyRaw };
})();
