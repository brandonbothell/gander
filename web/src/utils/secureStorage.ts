import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

// Simple encryption/decryption using Web Crypto API
class SecureStorage {
  private static readonly STORAGE_KEY = 'secureTokens';
  private static readonly ENCRYPTION_KEY_NAME = 'tokenEncryptionKey';
  private static encryptionKey: CryptoKey | null = null;

  // Generate or retrieve encryption key
  private static async getEncryptionKey(): Promise<CryptoKey> {
    if (this.encryptionKey) {
      return this.encryptionKey;
    }

    // Try to get existing key from localStorage
    const storedKey = localStorage.getItem(this.ENCRYPTION_KEY_NAME);

    if (storedKey) {
      try {
        const keyData = JSON.parse(storedKey);
        this.encryptionKey = await window.crypto.subtle.importKey(
          'raw',
          new Uint8Array(keyData),
          { name: 'AES-GCM' },
          false,
          ['encrypt', 'decrypt']
        );
        return this.encryptionKey;
      } catch (error) {
        console.warn('Failed to import existing encryption key, generating new one');
      }
    }

    // Generate new key
    this.encryptionKey = await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    // Export and store the key
    const exportedKey = await window.crypto.subtle.exportKey('raw', this.encryptionKey);
    localStorage.setItem(this.ENCRYPTION_KEY_NAME, JSON.stringify(Array.from(new Uint8Array(exportedKey))));

    return this.encryptionKey;
  }

  // Encrypt data
  private static async encrypt(data: string): Promise<string> {
    const key = await this.getEncryptionKey();
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      dataBuffer
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...combined));
  }

  // Decrypt data
  private static async decrypt(encryptedData: string): Promise<string> {
    try {
      const key = await this.getEncryptionKey();
      const combined = new Uint8Array(atob(encryptedData).split('').map(c => c.charCodeAt(0)));

      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);

      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encrypted
      );

      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      console.error('Failed to decrypt data:', error);
      throw new Error('Failed to decrypt stored data');
    }
  }

  // Set refresh token
  static async setRefreshToken(token: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      // Use Capacitor Preferences for native platforms
      await Preferences.set({ key: 'refreshToken', value: token });
    } else {
      // Use encrypted localStorage for web
      const encrypted = await this.encrypt(token);
      localStorage.setItem(this.STORAGE_KEY, encrypted);
    }
  }

  // Get refresh token
  static async getRefreshToken(): Promise<string | null> {
    if (Capacitor.isNativePlatform()) {
      // Use Capacitor Preferences for native platforms
      const result = await Preferences.get({ key: 'refreshToken' });
      return result.value;
    } else {
      // Use encrypted localStorage for web
      const encrypted = localStorage.getItem(this.STORAGE_KEY);
      if (!encrypted) return null;

      try {
        return await this.decrypt(encrypted);
      } catch (error) {
        console.error('Failed to decrypt refresh token:', error);
        // Remove corrupted token
        localStorage.removeItem(this.STORAGE_KEY);
        return null;
      }
    }
  }

  // Remove refresh token
  static async removeRefreshToken(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await Preferences.remove({ key: 'refreshToken' });
    } else {
      localStorage.removeItem(this.STORAGE_KEY);
    }
  }

  // Clear all secure storage (useful for logout)
  static async clearAll(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await Preferences.clear();
    } else {
      localStorage.removeItem(this.STORAGE_KEY);
      localStorage.removeItem(this.ENCRYPTION_KEY_NAME);
      this.encryptionKey = null;
    }
  }
}

export default SecureStorage;
