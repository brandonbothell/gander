// Create source/types/deviceInfo.ts
export interface TrustedDevice {
  ip: string
  deviceInfo: DeviceInfo
  firstSeen: string
  lastSeen: string
  loginCount: number
}

// Update DeviceInfo interface
export interface DeviceInfo {
  userAgent: string
  platform: string
  vendor: string
  language: string
  timezone: string
  screen: string
  clientId: string
}

export interface Session {
  ip: string
  location?: {
    country: string
    region: string
    city: string
    lat: number
    lon: number
    isp?: string
    timezone?: string
    postal?: string
    // eslint-disable-next-line @typescript-eslint/naming-convention
    country_code?: string
    asn?: string
  }
  firstSeen: string
  lastSeen: string
  isNew?: boolean
  isGeolocating?: boolean
  geolocated?: boolean
}

export function getDeviceDisplayName(deviceInfo: DeviceInfo): string {
  const { userAgent, platform } = deviceInfo

  // Extract browser info
  let browser = 'Unknown Browser'
  if (userAgent.includes('Chrome')) browser = 'Chrome'
  else if (userAgent.includes('Firefox')) browser = 'Firefox'
  else if (userAgent.includes('Safari')) browser = 'Safari'
  else if (userAgent.includes('Edge')) browser = 'Edge'

  // Extract OS info
  let os = platform
  if (userAgent.includes('Windows')) os = 'Windows'
  else if (userAgent.includes('Mac')) os = 'macOS'
  else if (userAgent.includes('Linux')) os = 'Linux'
  else if (userAgent.includes('Android')) os = 'Android'
  else if (userAgent.includes('iOS')) os = 'iOS'

  return `${browser} on ${os}`
}
