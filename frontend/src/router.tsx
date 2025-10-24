import { createBrowserRouter } from 'react-router-dom';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import TimelinePage from './pages/TimelinePage';
import CreateEventPage from './pages/CreateEventPage';
import EventDetailPage from './pages/EventDetailPage';
import ConversationsPage from './pages/ConversationsPage';
import CreateConversationPage from './pages/CreateConversationPage';
import ConversationDetailPage from './pages/ConversationDetailPage';
import PersonDetailPage from './pages/PersonDetailPage';
import PeoplePage from './pages/PeoplePage';
import SettingsLayout from './components/SettingsLayout';
import GeneralSettingsPage from './pages/settings/GeneralSettingsPage';
import APISettingsPage from './pages/settings/APISettingsPage';
import LLMSettingsPage from './pages/settings/LLMSettingsPage';
import CreateLLMPage from './pages/settings/CreateLLMPage';
import LLMDetailPage from './pages/settings/LLMDetailPage';
import NotFoundPage from './pages/NotFoundPage';
import TranscriptPage from './pages/TranscriptPage';
import ObjectsPage from './pages/ObjectsPage';
import ObjectDetailPage from './pages/ObjectDetailPage';
import CreateObjectPage from './pages/CreateObjectPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: 'timeline',
        element: <TimelinePage />,
      },
      {
        path: 'transcript',
        element: <TranscriptPage />,
      },
      {
        path: 'events/new',
        element: <CreateEventPage />,
      },
      {
        path: 'events/:id',
        element: <EventDetailPage />,
      },
      {
        path: 'conversations',
        element: <ConversationsPage />,
      },
      {
        path: 'conversations/new',
        element: <CreateConversationPage />,
      },
      {
        path: 'conversations/:id',
        element: <ConversationDetailPage />,
      },
      {
        path: 'people',
        element: <PeoplePage />,
      },
      {
        path: 'people/:id',
        element: <PersonDetailPage />,
      },
      {
        path: 'objects',
        element: <ObjectsPage />,
      },
      {
        path: 'objects/create',
        element: <CreateObjectPage />,
      },
      {
        path: 'objects/:id',
        element: <ObjectDetailPage />,
      },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          {
            index: true,
            element: <GeneralSettingsPage />,
          },
          {
            path: 'api',
            element: <APISettingsPage />,
          },
          {
            path: 'llms',
            element: <LLMSettingsPage />,
          },
          {
            path: 'llms/new',
            element: <CreateLLMPage />,
          },
          {
            path: 'llms/:id',
            element: <LLMDetailPage />,
          },
        ],
      },
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
]);
