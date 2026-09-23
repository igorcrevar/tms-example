import { execFileSync } from 'node:child_process';

/** Recreates the seeded staff user and driver the browser tests sign in as. */
export default function globalSetup(): void {
  execFileSync('npm', ['--prefix', '../tms-backend', 'run', 'seed:e2e'], { stdio: 'inherit' });
}
