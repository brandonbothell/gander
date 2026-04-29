import fs from 'fs'
import { motionLogPath, authLogPath } from './camera'

// Motion logging function

export async function logMotion(
  message: string,
  level: 'info' | 'error' | 'warn' = 'info',
) {
  const timestamp = new Date().toISOString()
  const logEntry = `${timestamp} [${level}] ${message}\n`
  try {
    await fs.promises.appendFile(`${motionLogPath}-latest.log`, logEntry)
  } catch (error) {
    console.error('Failed to write to motion log:', error)
  }
  if (level === 'error') {
    console.error(message)
  } else if (level === 'warn') {
    console.warn(message)
  }
}

export async function logAuth(
  message: string,
  level: 'info' | 'error' | 'warn' = 'info',
) {
  const timestamp = new Date().toISOString()
  const logEntry = `${timestamp} [${level}] ${message}\n`
  try {
    await fs.promises.appendFile(`${authLogPath}-latest.log`, logEntry)
  } catch (error) {
    console.error('Failed to write to auth log:', error)
  }

  if (level === 'error') {
    console.error(message)
  } else if (level === 'warn') {
    console.warn(message)
  }
}
