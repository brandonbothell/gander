import { Preferences } from '@capacitor/preferences'
import {
  type TrustedDevice,
  type DeviceInfo,
  type Session,
} from '../../../source/types/deviceInfo'
import { fetchWithRetry } from '../main'
import { Capacitor } from '@capacitor/core'

// Helper function to create a unique session identifier
export const getSessionId = (_: string, deviceInfo: DeviceInfo): string => {
  return deviceInfo.clientId
}

export const geolocateIP = async (
  knownSessions?: string[],
  device?: TrustedDevice,
) => {
  const ip = device?.ip || null
  try {
    const geoResponse = await fetchWithRetry(() =>
      fetch(`https://ipinfo.io/${ip ? ip + '/' : ''}json`),
    )
    const geoData = await geoResponse.json()

    if (geoData.error) {
      throw new Error(`API Error: ${geoData.error.message || 'Unknown error'}`)
    }

    const { ip: geoIp }: { ip: string } = geoData
    const [lat, lon] = geoData.loc
      ? geoData.loc.split(',').map(Number)
      : [null, null]

    if (lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon)) {
      const session: Session = {
        ip: geoIp,
        location: {
          country: geoData.country ?? 'Unknown',
          region: geoData.region ?? 'Unknown',
          city: geoData.city ?? 'Unknown',
          lat,
          lon,
          isp: geoData.org ?? undefined,
          timezone: geoData.timezone ?? undefined,
          postal: geoData.postal ?? undefined,
          country_code: geoData.country ?? undefined,
          asn: geoData.org?.split(' ')[0] ?? undefined,
        },
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        isNew: knownSessions
          ? device
            ? !knownSessions.includes(
                getSessionId(device.ip, device.deviceInfo),
              )
            : false
          : true,
        geolocated: true,
        isGeolocating: false,
      }
      return session
    } else {
      console.warn(`No valid coordinates found for IP ${ip}`)
      return {
        ip: geoIp,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        isNew: knownSessions
          ? device
            ? !knownSessions.includes(
                getSessionId(device.ip, device.deviceInfo),
              )
            : false
          : true,
        geolocated: true,
        isGeolocating: false,
      }
    }
  } catch (error) {
    console.error(`Failed to geolocate IP ${ip || 'local'}:`, error)
    return {
      ip: ip || 'local',
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      isNew: knownSessions
        ? device
          ? !knownSessions.includes(getSessionId(device.ip, device.deviceInfo))
          : false
        : false,
      geolocated: true,
      isGeolocating: false,
    }
  }
}

export async function getDeviceFingerprint(): Promise<DeviceInfo> {
  let clientId = localStorage.getItem('clientId')
  if (!clientId) {
    clientId = crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          const r = (Math.random() * 16) | 0
          const v = c === 'x' ? r : (r & 0x3) | 0x8
          return v.toString(16)
        })
    localStorage.setItem('clientId', clientId)
  }

  if (
    Capacitor.isNativePlatform() &&
    !(await Preferences.get({ key: 'clientId' })).value
  ) {
    await Preferences.set({ key: 'clientId', value: clientId })
  }

  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform ?? 'Unknown',
    vendor: navigator.vendor ?? 'Unknown',
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${screen.width}x${screen.height}`,
    clientId,
  }
}
