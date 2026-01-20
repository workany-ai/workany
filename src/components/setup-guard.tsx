/**
 * Setup Guard Component
 *
 * Checks if the app setup (dependency installation) is completed.
 * Redirects to the setup page if not completed.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { isSetupCompleted } from '@/shared/db/settings';
import { API_PORT } from '@/config';

interface SetupGuardProps {
  children: ReactNode;
}

export function SetupGuard({ children }: SetupGuardProps) {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    async function checkSetup() {
      try {
        const setupDone = await isSetupCompleted();

        if (!setupDone) {
          // Also check if this is actually the first run by calling the API
          // This handles the case where localStorage was cleared but deps are installed
          try {
            const response = await fetch(`http://localhost:${API_PORT}/health/dependencies`);
            const data = await response.json();

            if (data.success && data.allRequiredInstalled) {
              // Dependencies are installed, skip setup
              setCompleted(true);
            } else {
              // Redirect to setup page
              navigate('/setup', { replace: true });
              return;
            }
          } catch {
            // API not available, redirect to setup anyway
            navigate('/setup', { replace: true });
            return;
          }
        } else {
          setCompleted(true);
        }
      } catch (error) {
        console.error('[SetupGuard] Error checking setup:', error);
        // On error, allow access (don't block the app)
        setCompleted(true);
      } finally {
        setChecking(false);
      }
    }

    checkSetup();
  }, [navigate]);

  if (checking) {
    return (
      <div className="bg-background flex min-h-svh items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  if (!completed) {
    return null; // Will be redirected
  }

  return <>{children}</>;
}
