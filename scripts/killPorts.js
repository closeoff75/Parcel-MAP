/**
 * Port Manager Utility
 * Detects and terminates any orphan processes occupying port 3000 (Vite) or 3001 (API Server).
 */

import { execSync } from 'child_process';

const PORTS = [3000, 3001];

console.log('[PortManager] Checking for stale processes on ports:', PORTS.join(', '));

for (const port of PORTS) {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano | findstr LISTENING | findstr :${port}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      });

      const lines = output.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && Number(pid) !== process.pid) {
          try {
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
            console.log(`[PortManager] Cleaned up process PID ${pid} on port ${port}`);
          } catch {}
        }
      }
    } else {
      execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' });
      console.log(`[PortManager] Cleaned up port ${port}`);
    }
  } catch {
    // Port is clean
  }
}

console.log('[PortManager] Ports 3000 and 3001 are ready and clean.');
