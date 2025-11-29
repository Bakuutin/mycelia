import { createBrowserRouter } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import TimelinePage from "./pages/TimelinePage";
import CreateEventPage from "./pages/CreateEventPage";
import EventDetailPage from "./pages/EventDetailPage";
import SettingsLayout from "./components/SettingsLayout";
import GeneralSettingsPage from "./pages/settings/GeneralSettingsPage";
import APISettingsPage from "./pages/settings/APISettingsPage";
import LLMSettingsPage from "./pages/settings/LLMSettingsPage";
import CreateLLMPage from "./pages/settings/CreateLLMPage";
import LLMDetailPage from "./pages/settings/LLMDetailPage";
import APIKeysPage from "./pages/settings/APIKeysPage";
import FeatureFlagsPage from "./pages/settings/FeatureFlagsPage";
import PromptsPage from "./pages/settings/PromptsPage";
import PromptDetailPage from "./pages/settings/PromptDetailPage";
import NotFoundPage from "./pages/NotFoundPage";
import TranscriptPage from "./pages/TranscriptPage";
import DiarizationDetailPage from "./pages/DiarizationDetailPage";
import ObjectsPage from "./pages/ObjectsPage";
import ObjectDetailPage from "./pages/ObjectDetailPage";
import ObjectHistoryPage from "./pages/ObjectHistoryPage";
import CreateObjectPage from "./pages/CreateObjectPage";
import CreateAudioRecordPage from "./pages/CreateAudioRecordPage";
import AudioPlayerPage from "./pages/AudioPlayerPage";
import OAuthConsentPage from "./pages/OAuthConsentPage";

export const router = createBrowserRouter([
  {
    path: "/oauth/consent",
    element: <OAuthConsentPage />,
  },
  {
    path: "/",
    element: <Layout />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: "timeline",
        element: <TimelinePage />,
      },
      {
        path: "transcript",
        element: <TranscriptPage />,
      },
      {
        path: "diarizations/:id",
        element: <DiarizationDetailPage />,
      },
      {
        path: "audio",
        element: <AudioPlayerPage />,
      },
      {
        path: "audio/record",
        element: <CreateAudioRecordPage />,
      },
      {
        path: "events/new",
        element: <CreateEventPage />,
      },
      {
        path: "events/:id",
        element: <EventDetailPage />,
      },
      {
        path: "objects",
        element: <ObjectsPage />,
      },
      {
        path: "objects/create",
        element: <CreateObjectPage />,
      },
      {
        path: "objects/:id",
        element: <ObjectDetailPage />,
      },
      {
        path: "objects/:id/history",
        element: <ObjectHistoryPage />,
      },
      {
        path: "settings",
        element: <SettingsLayout />,
        children: [
          {
            index: true,
            element: <GeneralSettingsPage />,
          },
          {
            path: "api",
            element: <APISettingsPage />,
          },
          {
            path: "llms",
            element: <LLMSettingsPage />,
          },
          {
            path: "llms/new",
            element: <CreateLLMPage />,
          },
          {
            path: "llms/:id",
            element: <LLMDetailPage />,
          },
          {
            path: "api-keys",
            element: <APIKeysPage />,
          },
          {
            path: "feature-flags",
            element: <FeatureFlagsPage />,
          },
          {
            path: "prompts",
            element: <PromptsPage />,
          },
          {
            path: "prompts/new",
            element: <PromptDetailPage />,
          },
          {
            path: "prompts/:id",
            element: <PromptDetailPage />,
          },
        ],
      },
      {
        path: "*",
        element: <NotFoundPage />,
      },
    ],
  },
]);
