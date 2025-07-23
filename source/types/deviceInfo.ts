// Create source/types/deviceInfo.ts
export interface TrustedDevice {
  ip: string;
  deviceInfo: DeviceInfo;
  firstSeen: string;
  lastSeen: string;
  loginCount: number;
}

// Update DeviceInfo interface
export interface DeviceInfo {
  userAgent: string;
  platform: string;
  vendor: string;
  language: string;
  timezone: string;
  screen: string;
  clientId: string;
}


export function getDeviceFingerprint(): DeviceInfo {
  let clientId = localStorage.getItem('clientId');
  if (!clientId) {
    clientId = crypto.randomUUID ? crypto.randomUUID() :
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    localStorage.setItem('clientId', clientId);
  }

  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    vendor: navigator.vendor || 'Unknown',
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${screen.width}x${screen.height}`,
    clientId
  };
}

export function getDeviceDisplayName(deviceInfo: DeviceInfo): string {
  const { userAgent, platform } = deviceInfo;

  // Extract browser info
  let browser = 'Unknown Browser';
  if (userAgent.includes('Chrome')) browser = 'Chrome';
  else if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Safari')) browser = 'Safari';
  else if (userAgent.includes('Edge')) browser = 'Edge';

  // Extract OS info
  let os = platform;
  if (userAgent.includes('Windows')) os = 'Windows';
  else if (userAgent.includes('Mac')) os = 'macOS';
  else if (userAgent.includes('Linux')) os = 'Linux';
  else if (userAgent.includes('Android')) os = 'Android';
  else if (userAgent.includes('iOS')) os = 'iOS';

  return `${browser} on ${os}`;
}
