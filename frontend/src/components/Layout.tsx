import { Link, Outlet, useLocation } from "react-router-dom";
import { Clock, Home, Package, Settings, MessageSquare, Activity } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AudioPlayer, useAudioPlayer } from "@/modules/audio/player.tsx";
import { AudioWaveform } from "@/components/AudioWaveform";
import { Button } from "@/components/ui/button.tsx";
import { useJobsListener } from "@/hooks/useJobsListener";
import { Badge } from "@/components/ui/badge";

const Layout = () => {
  useTheme();
  const location = useLocation();
  const { isPlaying, setIsPlaying } = useAudioPlayer();
  const { runningCount } = useJobsListener();

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <nav className="border-b">
          <div className="mx-auto px-4 md:container">
            <div className="flex h-16 items-center justify-between">
              <div className="flex items-center gap-6">
                <Link to="/" className="text-xl font-bold">
                  Mycelia
                </Link>
                <div className="flex gap-4">
                  <Link
                    to="/timeline"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors relative ${location.pathname === "/timeline"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      }`}
                  >
                    <Clock className="w-4 h-4" />
                    Timeline
                  </Link>
                  <Link
                    to="/chat"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors relative ${location.pathname === "/chat"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      }`}
                  >
                    <MessageSquare className="w-4 h-4" />
                    Chat
                  </Link>
                  <Link
                    to="/objects"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors relative ${location.pathname === "/objects"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      }`}
                  >
                    <Package className="w-4 h-4" />
                    Objects
                  </Link>
                  <Link
                    to="/jobs"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors relative ${location.pathname === "/jobs"
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
                    to="/settings"
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors relative ${location.pathname === "/settings"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      }`}
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </Link>
                </div>
              </div>
              {isPlaying && (
                <Link to="/audio">
                  <Button
                    variant="ghost"
                    size="icon"
                  >
                    <AudioWaveform size={20} />
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </nav>
        <main className="mx-auto md:px-4 py-6 md:container">
          <Outlet />
        </main>
      </div>
      <AudioPlayer />
    </TooltipProvider>
  );
};

export default Layout;
