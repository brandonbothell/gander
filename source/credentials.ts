import * as admin from 'firebase-admin'
import credentials from '../security-cam-credentials.json'

export const JWT_SECRET = process.env.JWT_SECRET as string

export function initializeCredentials() {
  if (!JWT_SECRET) {
    console.error('JWT_SECRET environment variable is not set!')
    process.exit(1)
  }

  if (!admin.getApps().length) {
    admin.initializeApp({
      credential: admin.cert({
        projectId: credentials.project_id,
        clientEmail: credentials.client_email,
        privateKey: credentials.private_key,
      }),
    })
  }
}
