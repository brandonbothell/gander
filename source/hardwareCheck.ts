const { execSync } = require('child_process')

let hasNvidiaHardware = false

try {
  // Execute a fast probe that exits immediately without printing outputs to the console
  // Works on both Windows and Linux environments
  execSync('nvidia-smi --help', { stdio: 'ignore' })
  hasNvidiaHardware = true
  console.log(
    '[System Probe] Nvidia hardware capability detected successfully.',
  )
} catch (error) {
  hasNvidiaHardware = false
  console.log(
    '[System Probe] Nvidia hardware not available. Falling back to CPU/Direct methods.',
  )
}

// Export the live state variable
export const isNvidiaAvailable = () => hasNvidiaHardware
