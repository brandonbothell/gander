import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

class SecureStorageService {
  private isSecureContext(): boolean {
    return (
      window.isSecureContext ||
      location.protocol === 'https:' ||
      location.hostname === 'localhost'
    )
  }

  private async getEncryptionKey(): Promise<CryptoKey | null> {
    // Only use Web Crypto API in secure contexts
    if (!this.isSecureContext() || !window.crypto?.subtle) {
      return null
    }

    try {
      // Try to get existing key from IndexedDB or generate new one
      const keyData = localStorage.getItem('_encKey')
      if (keyData) {
        const rawKey = new Uint8Array(JSON.parse(keyData))
        return await window.crypto.subtle.importKey(
          'raw',
          rawKey,
          { name: 'AES-GCM' },
          false,
          ['encrypt', 'decrypt'],
        )
      }

      // Generate new key
      const key = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
      )

      // Export and store key
      const rawKey = await window.crypto.subtle.exportKey('raw', key)
      localStorage.setItem(
        '_encKey',
        JSON.stringify(Array.from(new Uint8Array(rawKey))),
      )

      return key
    } catch (error) {
      console.warn('Failed to get encryption key:', error)
      return null
    }
  }

  private async encrypt(text: string): Promise<string> {
    const key = await this.getEncryptionKey()

    // Fallback to base64 encoding if no encryption available
    if (!key || !window.crypto?.subtle) {
      console.warn('Encryption not available, using base64 encoding')
      return btoa(text)
    }

    try {
      const iv = window.crypto.getRandomValues(new Uint8Array(12))
      const encoded = new TextEncoder().encode(text)
      const encrypted = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoded,
      )

      return JSON.stringify({
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(encrypted)),
      })
    } catch (error) {
      console.warn('Encryption failed, using base64 fallback:', error)
      return btoa(text)
    }
  }

  private async decrypt(encryptedText: string): Promise<string> {
    const key = await this.getEncryptionKey()

    // Handle base64 fallback
    if (!key || !window.crypto?.subtle) {
      try {
        return atob(encryptedText)
      } catch (error) {
        console.error('Failed to decode base64:', error)
        throw new Error('Failed to decrypt token')
      }
    }

    try {
      // Try to parse as encrypted JSON first
      const { iv, data } = JSON.parse(encryptedText)
      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        key,
        new Uint8Array(data),
      )

      return new TextDecoder().decode(decrypted)
    } catch (error) {
      // Fallback to base64 decoding for legacy tokens
      try {
        return atob(encryptedText)
      } catch (_) {
        console.error('Failed to decrypt token:', error)
        throw new Error('Failed to decrypt token')
      }
    }
  }

  async setRefreshToken(token: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await Preferences.set({
        key: 'refreshToken',
        value: token,
      })
    } else {
      const encrypted = await this.encrypt(token)
      localStorage.setItem('_rt', encrypted)
    }
  }

  async getRefreshToken(): Promise<string | null> {
    if (Capacitor.isNativePlatform()) {
      const result = await Preferences.get({ key: 'refreshToken' })
      return result.value
    } else {
      const encrypted = localStorage.getItem('_rt')
      if (!encrypted) return null

      try {
        return await this.decrypt(encrypted)
      } catch (error) {
        console.error('Failed to decrypt refresh token:', error)
        // Clear corrupted token
        localStorage.removeItem('_rt')
        return null
      }
    }
  }

  async removeRefreshToken(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await Preferences.remove({ key: 'refreshToken' })
    } else {
      localStorage.removeItem('_rt')
    }
  }

  async setClientId(clientId: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await Preferences.set({
        key: 'clientId',
        value: clientId,
      })
    } else {
      const encrypted = await this.encrypt(clientId)
      localStorage.setItem('_cid', encrypted)
    }
  }

  async getClientId(): Promise<string | null> {
    if (Capacitor.isNativePlatform()) {
      const result = await Preferences.get({ key: 'clientId' })
      return result.value
    } else {
      const encrypted = localStorage.getItem('_cid')
      if (!encrypted) return null

      try {
        return await this.decrypt(encrypted)
      } catch (error) {
        console.error('Failed to decrypt client ID:', error)
        // Clear corrupted token
        localStorage.removeItem('_cid')
        return null
      }
    }
  }

  async clearAll(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await Preferences.clear()
    } else {
      localStorage.removeItem('_rt')
      localStorage.removeItem('_encKey')
    }
  }
}

const SecureStorage = new SecureStorageService()
export default SecureStorage
