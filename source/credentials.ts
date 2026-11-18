import * as path from 'path'
import * as fs from 'fs'
import * as admin from 'firebase-admin'

export const JWT_SECRET = process.env.JWT_SECRET as string

export function initializeCredentials() {
  const credentialsPath = path.resolve(
    __dirname,
    '../security-cam-credentials.json',
  )
  if (!fs.existsSync(credentialsPath)) {
    console.warn(
      `[Firebase] Credentials file not found: ${credentialsPath}; skipping app initialization.`,
    )
    return
  }

  if (!JWT_SECRET) {
    console.error('JWT_SECRET environment variable is not set!')
    process.exit(1)
  }

  try {
    if (!admin.getApps().length) {
      const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
      admin.initializeApp({
        credential: admin.cert({
          projectId: credentials.project_id,
          clientEmail: credentials.client_email,
          privateKey: credentials.private_key,
        }),
      })
    }
  } catch (err) {
    console.error('Error initializing Firebase: ', err)
  }
}

export function getMobileSdkAppId() {
  const credentialsPath = path.resolve(__dirname, '../google-services.json')

  if (!fs.existsSync(credentialsPath)) {
    console.warn(
      `[Firebase] Credentials file not found: ${credentialsPath}; unable to verify app check token validity. Android app won't work!`,
    )
    return
  }

  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
  return credentials.client?.client_info?.mobilesdk_app_id as string
}
