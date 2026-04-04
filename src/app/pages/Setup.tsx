/**
 * Setup Page
 *
 * Previously handled CLI tool installation.
 * Now redirects to home since setup is handled by SetupGuard inline.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface SetupPageProps {
  onSkip?: () => void;
}

export function SetupPage({ onSkip }: SetupPageProps = {}) {
  const navigate = useNavigate();

  useEffect(() => {
    if (onSkip) {
      onSkip();
    } else {
      navigate('/', { replace: true });
    }
  }, [navigate, onSkip]);

  return null;
}
