import path from 'path'
import admin from 'firebase-admin'

export const JWT_SECRET = process.env.JWT_SECRET as string

export function initializeCredentials() {
  if (!JWT_SECRET) {
    console.error('JWT_SECRET environment variable is not set!')
    process.exit(1)
  }

  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(
    __dirname,
    '..',
    'security-cam-credentials.json',
  )

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    })
  }
}
