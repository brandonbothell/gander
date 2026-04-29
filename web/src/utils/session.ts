import {
  type TrustedDevice,
  type DeviceInfo,
  type Session,
} from '../../../source/types/deviceInfo'
import { fetchWithRetry } from '../main'

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
    // console.log(`Geolocating IP ${ip || 'local'}...`);
    const geoResponse = await fetchWithRetry(() =>
      fetch(`https://ipinfo.io/${ip ? ip + '/' : ''}json`),
    )
    const geoData = await geoResponse.json()

    // console.log(`Geolocation data for ${ip || 'local'}:`, geoData);

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
      // console.log(`Successfully created session for ${ip}`);
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
