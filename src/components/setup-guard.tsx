/**
 * Setup Guard Component
 *
 * Previously checked if Claude Code CLI was installed on app startup.
 * Now that we use @codeany/open-agent-sdk (in-process, no CLI dependency),
 * this guard simply passes through to children.
 */

import type { ReactNode } from 'react';

interface SetupGuardProps {
  children: ReactNode;
}

// Kept for API compatibility with existing imports
export function clearDependencyCache() {
  // No-op: no external dependencies to check
}

export function SetupGuard({ children }: SetupGuardProps) {
  return <>{children}</>;
}
