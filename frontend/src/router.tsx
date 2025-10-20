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
import SettingsPage from './pages/SettingsPage';
import NotFoundPage from './pages/NotFoundPage';
import TopicsPage from './pages/TopicsPage';
import TranscriptPage from './pages/TranscriptPage';

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
        path: 'topics',
        element: <TopicsPage />,
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
        path: 'settings',
        element: <SettingsPage />,
      },
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
]);
