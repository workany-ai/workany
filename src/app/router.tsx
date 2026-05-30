import { createBrowserRouter } from 'react-router-dom';
import {
  HomePage,
  LibraryPage,
  SetupPage,
  TaskDetailPage,
  AgentsPage,
  AgentDetailPage,
  TeamsPage,
  TeamDetailPage,
  ProjectsPage,
  ProjectDetailPage,
} from '@/app/pages';

import { SetupGuard } from '@/components/setup-guard';
import { AppLayout } from '@/components/layout/app-layout';

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <SetupGuard>
        <AppLayout />
      </SetupGuard>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: 'task/:taskId', element: <TaskDetailPage /> },
      { path: 'library', element: <LibraryPage /> },
      { path: 'agents', element: <AgentsPage /> },
      { path: 'agents/new', element: <AgentDetailPage /> },
      { path: 'agents/:agentId', element: <AgentDetailPage /> },
      { path: 'teams', element: <TeamsPage /> },
      { path: 'teams/new', element: <TeamDetailPage /> },
      { path: 'teams/:teamId', element: <TeamDetailPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/new', element: <ProjectDetailPage /> },
      { path: 'projects/:projectId', element: <ProjectDetailPage /> },
    ],
  },
  {
    path: '/setup',
    element: <SetupPage />,
  },
]);
