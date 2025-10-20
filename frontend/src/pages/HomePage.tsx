import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

const HomePage = () => {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">Welcome to Mycelia</h1>
        <p className="text-xl text-muted-foreground">
          Your personal memory assistant
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Link
          to="/timeline"
          className="p-6 border rounded-lg hover:border-primary transition-colors group"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold">Timeline</h2>
            <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <p className="text-muted-foreground">
            View your audio recordings, transcriptions, and events on an interactive timeline
          </p>
        </Link>

        <Link
          to="/topics"
          className="p-6 border rounded-lg hover:border-primary transition-colors group"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold">Topics</h2>
            <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <p className="text-muted-foreground">
            Browse recent topics extracted from your conversations, newest first
          </p>
        </Link>

        <Link
          to="/conversations"
          className="p-6 border rounded-lg hover:border-primary transition-colors group"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold">Conversations</h2>
            <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <p className="text-muted-foreground">
            Browse and manage your conversation summaries with multiple time intervals
          </p>
        </Link>

        <Link
          to="/people"
          className="p-6 border rounded-lg hover:border-primary transition-colors group"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold">People</h2>
            <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <p className="text-muted-foreground">
            View and manage people from your conversations
          </p>
        </Link>
      </div>

      <div className="p-6 border rounded-lg bg-muted/50">
        <h3 className="text-lg font-semibold mb-2">Getting Started</h3>
        <ul className="space-y-2 text-muted-foreground">
          <li>• Upload audio files through the timeline interface</li>
          <li>• Create events and conversations to organize your memories</li>
          <li>• Use the search functionality to find specific moments</li>
          <li>• Share conversations with others via shareable links</li>
        </ul>
      </div>
    </div>
  );
};

export default HomePage;
