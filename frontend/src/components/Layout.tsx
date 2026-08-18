import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  Clock,
  FileText,
  Home,
  Map as MapIcon,
  MessageSquare,
  Mic,
  Package,
  Settings,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AudioPlayer } from "@/modules/audio/player.tsx";
import { useJobsListener } from "@/hooks/useJobsListener";
import { Badge } from "@/components/ui/badge";
import { NotificationCenter } from "@/components/NotificationCenter";
import { GlobalAudioPlayerPopover } from "@/components/GlobalAudioPlayerPopover";
import { ChatNotificationCoordinator } from "@/components/chat/ChatNotificationCoordinator";

const Layout = () => {
  useTheme();
  const location = useLocation();
  const { clientId, clientSecret } = useSettingsStore();
  const { runningCount } = useJobsListener({
    statuses: ["active", "waiting", "delayed"],
    limit: 200,
  });

  // Redirect to setup if no credentials
  if (!clientId || !clientSecret) {
    return <Navigate to="/setup" replace />;
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <nav className="max-w-full overflow-x-auto border-b">
          <div className="w-max min-w-full px-4 md:container md:mx-auto md:w-auto">
            <div className="flex h-16 items-center justify-between">
              <div className="flex items-center gap-6">
                <Link to="/" className="text-xl font-bold">
                  Mycelia
                </Link>
                <div className="flex gap-4">
                  <Link
                    to="/timeline"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors relative ${
                      location.pathname === "/timeline"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <Clock className="w-4 h-4" />
                    Timeline
                  </Link>
                  <Link
                    to="/map"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors relative ${
                      location.pathname === "/map"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <MapIcon className="w-4 h-4" />
                    Map
                  </Link>
                  <Link
                    to="/chat"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors relative ${
                      location.pathname === "/chat" ||
                        location.pathname.startsWith("/chat/")
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <MessageSquare className="w-4 h-4" />
                    Chat
                  </Link>
                  <Link
                    to="/objects"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors relative ${
                      location.pathname === "/objects"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <Package className="w-4 h-4" />
                    Objects
                  </Link>
                  <Link
                    to="/jobs"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors relative ${
                      location.pathname === "/jobs"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <Activity className="w-4 h-4" />
                    Jobs
                    {runningCount > 0 && (
                      <Badge
                        variant="destructive"
                        className="ml-1 h-5 min-w-5 px-1.5 flex items-center justify-center text-xs"
                      >
                        {runningCount}
                      </Badge>
                    )}
                  </Link>
                  <Link
                    to="/summaries"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors relative ${
                      location.pathname.startsWith("/summaries")
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <FileText className="w-4 h-4" />
                    AI History
                  </Link>
                  <Link
                    to="/audio/pipeline"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors relative ${
                      location.pathname === "/audio/pipeline"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                    data-testid="nav-pipeline"
                  >
                    <Mic className="w-4 h-4" />
                    Pipeline
                  </Link>
                  <Link
                    to="/settings"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors relative ${
                      location.pathname === "/settings"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </Link>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <NotificationCenter />
                <GlobalAudioPlayerPopover />
              </div>
            </div>
          </div>
        </nav>
        <main className="mx-auto md:px-4 py-6 md:container">
          <Outlet />
        </main>
      </div>
      <AudioPlayer />
      <ChatNotificationCoordinator />
    </TooltipProvider>
  );
};

export default Layout;
