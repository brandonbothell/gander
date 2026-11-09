export function playNotificationSound() {
  console.log('Playing motion sound...')

  if (isIOS()) {
    const audio = new Audio('/sounds/recording-started.mp3')
    audio.volume = 0.3
    const playPromise = audio.play()
    if (playPromise) {
      playPromise
        .then(() => {
          console.log('Motion notification sound played successfully')
        })
        .catch((error) => {
          console.log('Motion notification sound blocked:', error)
          try {
            playNotificationTone()
          } catch (e) {
            console.log('Notification tone fallback failed:', e)
          }
        })
    }
  } else {
    const audio = new Audio('/sounds/recording-started.mp3')
    audio
      .play()
      .then(() => {
        console.log('Motion notification sound played successfully')
      })
      .catch((error) => {
        console.log('Motion notification sound failed to play:', error)
      })
  }
}

export function playNotificationTone() {
  // Fallback: Create a brief notification tone using Web Audio API
  // This is less likely to interrupt other audio
  try {
    const AudioContext =
      window.AudioContext ??
      (
        window as typeof window & {
          webkitAudioContext?: typeof window.AudioContext
        }
      ).webkitAudioContext
    const audioContext = new AudioContext()

    // Create a brief, subtle notification tone
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)

    // Configure the tone
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime) // 800Hz tone
    gainNode.gain.setValueAtTime(0, audioContext.currentTime)
    gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.01) // Fade in
    gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.15) // Fade out

    // Play for 150ms
    oscillator.start(audioContext.currentTime)
    oscillator.stop(audioContext.currentTime + 0.15)

    // Clean up
    setTimeout(() => {
      try {
        audioContext.close()
      } catch (_) {
        // Ignore cleanup errors
      }
    }, 200)
  } catch (error) {
    console.log('Web Audio API notification tone failed:', error)
  }
}

export function isLocalIPv4(ip: string) {
  // Strict format validation (0-255 for each octet)
  const ipv4Pattern =
    /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
  if (!ipv4Pattern.test(ip)) {
    return false
  }

  // Regex matching Loopback, Link-Local, and RFC 1918 Private ranges
  const localPattern =
    /^(?:192\.168\.|169\.254\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)/
  return localPattern.test(ip)
}

export function isIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && 'ontouchend' in document)
  )
}
