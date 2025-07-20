const CryptoJS = require('crypto-js');
const crypto = require('crypto');

let sessionKeys = {
    aesKey: "",
    iv: "",
    hmacKey: ""
};

// Fallback keys for testing (temporary solution)
const FALLBACK_KEYS = {
    aesKey: "dPEujynME4Ih/3YhfZ9TBoVhGQdKDyfj6H6BLPPPb5o==",
    iv: "VwOdPuCwI2gvhO87cJZJFw==",
    hmacKey: "RnKTjXRaYOm8AO4Rg/+n8IFY/O1bwY8S4KfmIjzEWwg="
};

function setSessionKeys({aesKey, iv, hmacKey}) {
    if (typeof aesKey !== 'string' || typeof iv !== 'string' || typeof hmacKey !== 'string') {
        console.warn('❌ SessionKey fields are not strings:', {aesKey, iv, hmacKey});
        return false;
    }
    if (!aesKey || !iv || !hmacKey) {
        console.warn('❌ SessionKey fields are empty:', {aesKey, iv, hmacKey});
        return false;
    }
    sessionKeys.aesKey = aesKey;
    sessionKeys.iv = iv;
    sessionKeys.hmacKey = hmacKey;
    console.log('✅ Session keys set successfully:', {
        aesKey: aesKey.slice(0, 6) + '...(' + aesKey.length + ')',
        iv: iv.slice(0, 6) + '...(' + iv.length + ')',
        hmacKey: hmacKey.slice(0, 6) + '...(' + hmacKey.length + ')'
    });
    return true;
}

function areSessionKeysValid() {
    return sessionKeys.aesKey && sessionKeys.iv && sessionKeys.hmacKey;
}

function generateUUID() {
    return crypto.randomUUID();
}

function encryptMessage(data) {
    // Sử dụng key hiện tại, nếu chưa có thì chỉ dùng fallback cho lần này (không ghi đè sessionKeys)
    let useKeys = areSessionKeysValid() ? sessionKeys : FALLBACK_KEYS;
    if (!areSessionKeysValid()) {
        console.warn('⚠️ Session keys not set, using fallback keys (encryptMessage)');
    }
    
    const timestamp = Date.now();
    const nonce = generateUUID();
    const messageData = JSON.stringify({
        timestamp: timestamp,
        nonce: nonce,
        data: data
    });
    
    try {
        const aesKey = CryptoJS.enc.Base64.parse(useKeys.aesKey);
        const iv = CryptoJS.enc.Base64.parse(useKeys.iv);
        const hmacKey = CryptoJS.enc.Base64.parse(useKeys.hmacKey);
        
        const encrypted = CryptoJS.AES.encrypt(messageData, aesKey, {
            iv: iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        }).toString();
        
        // Signature HEX (đồng bộ crypto-functions)
        const signature = CryptoJS.HmacSHA256(encrypted + nonce + timestamp, hmacKey).toString();
        
        return JSON.stringify({
            ciphertext: encrypted,
            nonce: nonce,
            timestamp: timestamp,
            signature: signature
        });
    } catch (error) {
        console.warn('❌ Encryption failed:', error.message);
        return null;
    }
}

function decryptMessage(encryptedMessage) {
    try {
        const {ciphertext, nonce, timestamp, signature} = typeof encryptedMessage === 'string' ? JSON.parse(encryptedMessage) : encryptedMessage;
        
        // Sử dụng key hiện tại, nếu chưa có thì chỉ dùng fallback cho lần này (không ghi đè sessionKeys)
        let useKeys = areSessionKeysValid() ? sessionKeys : FALLBACK_KEYS;
        if (!areSessionKeysValid()) {
            console.warn('⚠️ Session keys not set, using fallback keys for decryption');
        }
        
        const hmacKey = CryptoJS.enc.Base64.parse(useKeys.hmacKey);
        // Signature HEX
        const expectedSig = CryptoJS.HmacSHA256(ciphertext + nonce + timestamp, hmacKey).toString();
        
        if (expectedSig !== signature) {
            console.warn('❌ Signature verification failed');
            console.warn('Expected:', expectedSig);
            console.warn('Received:', signature);
            return null;
        }
        
        const aesKey = CryptoJS.enc.Base64.parse(useKeys.aesKey);
        const iv = CryptoJS.enc.Base64.parse(useKeys.iv);
        
        const decrypted = CryptoJS.AES.decrypt(ciphertext, aesKey, {
            iv: iv,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        });
        
        let decryptedString;
        try {
            decryptedString = decrypted.toString(CryptoJS.enc.Utf8);
        } catch (error) {
            console.warn("❌ UTF-8 decoding failed:", error.message);
            // Try alternative encoding
            try {
                decryptedString = decrypted.toString(CryptoJS.enc.Hex);
                console.warn("⚠️ Using Hex encoding as fallback");
            } catch (hexError) {
                console.warn("❌ Hex encoding also failed:", hexError.message);
                return null;
            }
        }
        
        if (!decryptedString) {
            console.warn("❌ Decryption failed - empty result");
            return null;
        }
        
        try {
            const parsed = JSON.parse(decryptedString);
            return parsed.data;
        } catch (parseError) {
            console.warn("❌ Failed to parse decrypted JSON:", parseError.message);
            console.warn("Decrypted string:", decryptedString);
            return null;
        }
    } catch (error) {
        console.warn("❌ decryptMessage failed:", error.message);
        return null;
    }
}

function clearSessionKeys() {
    sessionKeys.aesKey = "";
    sessionKeys.iv = "";
    sessionKeys.hmacKey = "";
}

function getSessionKeysStatus() {
    return {
        hasAesKey: !!sessionKeys.aesKey,
        hasIv: !!sessionKeys.iv,
        hasHmacKey: !!sessionKeys.hmacKey,
        isValid: areSessionKeysValid(),
        isUsingFallback: !areSessionKeysValid()
    };
}

function testEncryption() {
    // Set fallback keys for testing if not set
    if (!areSessionKeysValid()) {
        console.log('⚠️ Using fallback keys for testing');
        sessionKeys = { ...FALLBACK_KEYS };
    }
    
    const testData = { type: 'test', payload: { message: 'Hello World' } };
    const encrypted = encryptMessage(testData);
    if (!encrypted) {
        console.log('❌ Encryption test failed');
        return false;
    }
    const decrypted = decryptMessage(encrypted);
    if (!decrypted) {
        console.log('❌ Decryption test failed');
        return false;
    }
    console.log('✅ Encryption/Decryption test passed');
    return true;
}

module.exports = {
    setSessionKeys,
    encryptMessage,
    decryptMessage,
    clearSessionKeys,
    getSessionKeysStatus,
    areSessionKeysValid,
    testEncryption
}; 