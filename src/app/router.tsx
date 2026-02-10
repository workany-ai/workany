import { createBrowserRouter } from 'react-router-dom';
import {
  BotChatPage,
  HomePage,
  LibraryPage,
  SetupPage,
  TaskDetailPage,
} from '@/app/pages';

import { SetupGuard } from '@/components/setup-guard';

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <SetupGuard>
        <HomePage />
      </SetupGuard>
    ),
  },
  {
    path: '/bot',
    element: (
      <SetupGuard>
        <BotChatPage />
      </SetupGuard>
    ),
  },
  {
    path: '/task/:taskId',
    element: (
      <SetupGuard>
        <TaskDetailPage />
      </SetupGuard>
    ),
  },
  {
    path: '/library',
    element: (
      <SetupGuard>
        <LibraryPage />
      </SetupGuard>
    ),
  },
  {
    path: '/setup',
    element: <SetupPage />,
  },
]);
