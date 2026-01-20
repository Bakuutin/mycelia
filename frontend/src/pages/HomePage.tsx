import { Link } from "react-router-dom";
import { 
  ArrowRight, 
  Clock, 
  MessageSquare, 
  AudioWaveform, 
  Mic, 
  Download, 
  FolderTree,
  FileText,
  Package,
  MessagesSquare
} from "lucide-react";

const HomePage = () => {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">
          Welcome to Mycelia
        </h1>
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
            <h2 className="text-2xl font-semibold flex items-center gap-3">
              <Clock className="w-6 h-6 text-primary" />
              Timeline
            </h2>
            <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <p className="text-muted-foreground">
            View your audio recordings, transcriptions, and events on an
            interactive timeline
          </p>
        </Link>

        <Link
          to="/chat"
          className="p-6 border rounded-lg hover:border-primary transition-colors group"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold flex items-center gap-3">
              <MessageSquare className="w-6 h-6 text-primary" />
              Chat
            </h2>
            <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <p className="text-muted-foreground">
            Interactive AI assistant with access to your memories
          </p>
        </Link>

        {/* Audio Card with sub-links */}
        <div className="p-6 border rounded-lg flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold flex items-center gap-3">
              <AudioWaveform className="w-6 h-6 text-primary" />
              Audio
            </h2>
          </div>
          
          <div className="grid grid-cols-1 gap-2">
            <Link
              to="/audio"
              className="flex items-center justify-between p-3 rounded-md hover:bg-accent group transition-colors"
            >
              <div className="flex items-center gap-3">
                <AudioWaveform className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                <span className="font-medium">Audio Player</span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary" />
            </Link>

            <Link
              to="/audio/record"
              className="flex items-center justify-between p-3 rounded-md hover:bg-accent group transition-colors"
            >
              <div className="flex items-center gap-3">
                <Mic className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                <span className="font-medium">Record</span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary" />
            </Link>

            <Link
              to="/audio/export"
              className="flex items-center justify-between p-3 rounded-md hover:bg-accent group transition-colors"
            >
              <div className="flex items-center gap-3">
                <Download className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                <span className="font-medium">Export</span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary" />
            </Link>

            <Link
              to="/audio/source_files"
              className="flex items-center justify-between p-3 rounded-md hover:bg-accent group transition-colors"
            >
              <div className="flex items-center gap-3">
                <FolderTree className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                <span className="font-medium">Source Files</span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary" />
            </Link>
          </div>
        </div>

        {/* Transcripts Card with sub-links */}
        <div className="p-6 border rounded-lg flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold flex items-center gap-3">
              <FileText className="w-6 h-6 text-primary" />
              Transcripts
            </h2>
          </div>
          
          <div className="grid grid-cols-1 gap-2">
            <Link
              to="/transcript"
              className="flex items-center justify-between p-3 rounded-md hover:bg-accent group transition-colors"
            >
              <div className="flex items-center gap-3">
                <FileText className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                <span className="font-medium">Raw Transcript</span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary" />
            </Link>

            <Link
              to="/conversations"
              className="flex items-center justify-between p-3 rounded-md hover:bg-accent group transition-colors"
            >
              <div className="flex items-center gap-3">
                <MessagesSquare className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                <span className="font-medium">Conversations</span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary" />
            </Link>
          </div>
        </div>

        <Link
          to="/objects"
          className="p-6 border rounded-lg hover:border-primary transition-colors group"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold flex items-center gap-3">
              <Package className="w-6 h-6 text-primary" />
              Objects
            </h2>
            <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <p className="text-muted-foreground">
            Manage your personal data, entities, and memories
          </p>
        </Link>

        <Link
          to="/messaging"
          className="p-6 border rounded-lg hover:border-primary transition-colors group"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-semibold flex items-center gap-3">
              <MessageSquare className="w-6 h-6 text-primary" />
              Messenger
            </h2>
            <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <p className="text-muted-foreground">
            Chat history across platforms
          </p>
        </Link>
      </div>

      <div className="p-6 border rounded-lg bg-muted/50">
        <h3 className="text-lg font-semibold mb-2">Getting Started</h3>
        <ul className="space-y-2 text-muted-foreground">
          <li>• Upload audio files through the timeline interface</li>
          <li>• Create events and objects to organize your memories</li>
          <li>• Use the search functionality to find specific moments</li>
          <li>• Manage relationships between different objects and events</li>
        </ul>
      </div>
    </div>
  );
};

export default HomePage;
