import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { router } from './app/router';
import { initializeSettings } from './shared/db/settings';
import { BotChatProvider } from './shared/providers/bot-chat-provider';
import { LanguageProvider } from './shared/providers/language-provider';
import { ThemeProvider } from './shared/providers/theme-provider';

import '@/config/style/global.css';

// Initialize settings from database on startup, then render app
initializeSettings()
  .catch((error) => {
    console.error('Failed to initialize settings:', error);
  })
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <React.StrictMode>
        <LanguageProvider>
          <BotChatProvider>
            <ThemeProvider>
              <RouterProvider router={router} />
            </ThemeProvider>
          </BotChatProvider>
        </LanguageProvider>
      </React.StrictMode>
    );
  });
