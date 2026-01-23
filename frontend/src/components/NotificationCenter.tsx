import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, CheckCheck, Trash2, X, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useNotificationStore,
  selectUnreadCount,
  type Notification,
  type NotificationType,
} from "@/stores/notificationStore";
import { cn } from "@/lib/utils";

type FilterType = "all" | "error" | "success";

function formatTimestamp(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function NotificationItem({
  notification,
  onAction,
  onRemove,
  onMarkRead,
}: {
  notification: Notification;
  onAction: (path: string) => void;
  onRemove: (id: string) => void;
  onMarkRead: (id: string) => void;
}) {
  const typeStyles = {
    success: "border-l-green-500",
    error: "border-l-red-500",
    warning: "border-l-yellow-500",
    info: "border-l-blue-500",
  };

  return (
    <div
      className={cn(
        "p-3 border-l-4 rounded-r-md bg-muted/50 hover:bg-muted transition-colors",
        typeStyles[notification.type],
        !notification.read && "bg-accent/50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">
              {notification.title}
            </span>
            {!notification.read && (
              <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
            )}
          </div>
          {notification.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {notification.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-xs text-muted-foreground">
              {formatTimestamp(notification.timestamp)}
            </span>
            {notification.action && (
              <>
                <span className="text-muted-foreground">•</span>
                <button
                  onClick={() => onAction(notification.action!.path)}
                  className="text-xs text-primary hover:underline"
                >
                  {notification.action.label}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!notification.read && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onMarkRead(notification.id)}
            >
              <Check className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(notification.id)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function NotificationCenter() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterType>("all");
  const {
    notifications,
    showPopups,
    markAsRead,
    markAllAsRead,
    removeNotification,
    clearAll,
    setShowPopups,
  } = useNotificationStore();
  const unreadCount = useNotificationStore(selectUnreadCount);

  const errorCount = useMemo(
    () => notifications.filter((n) => n.type === "error").length,
    [notifications]
  );

  const filteredNotifications = useMemo(() => {
    if (filter === "all") return notifications;
    return notifications.filter((n) => n.type === filter);
  }, [notifications, filter]);

  const handleAction = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 min-w-5 px-1 flex items-center justify-center text-xs"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between p-3 border-b">
          <h3 className="font-semibold">Notifications</h3>
          <div className="flex items-center gap-2">
            {notifications.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={markAllAsRead}
                >
                  <CheckCheck className="h-3 w-3 mr-1" />
                  Read all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-destructive hover:text-destructive"
                  onClick={clearAll}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex border-b">
          <button
            onClick={() => setFilter("all")}
            className={cn(
              "flex-1 px-3 py-2 text-xs font-medium transition-colors",
              filter === "all"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            All ({notifications.length})
          </button>
          <button
            onClick={() => setFilter("error")}
            className={cn(
              "flex-1 px-3 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1",
              filter === "error"
                ? "border-b-2 border-red-500 text-red-500"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <AlertCircle className="h-3 w-3" />
            Errors ({errorCount})
          </button>
          <button
            onClick={() => setFilter("success")}
            className={cn(
              "flex-1 px-3 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1",
              filter === "success"
                ? "border-b-2 border-green-500 text-green-500"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <CheckCircle2 className="h-3 w-3" />
            Success
          </button>
        </div>

        <div className="h-[400px] overflow-y-auto">
          {filteredNotifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {filter === "error" ? (
                <>
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-50 text-green-500" />
                  <p className="text-sm">No failed jobs</p>
                </>
              ) : filter === "success" ? (
                <>
                  <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No completed jobs</p>
                </>
              ) : (
                <>
                  <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No notifications</p>
                </>
              )}
            </div>
          ) : (
            <div className="p-2 space-y-2">
              {filteredNotifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onAction={handleAction}
                  onRemove={removeNotification}
                  onMarkRead={markAsRead}
                />
              ))}
            </div>
          )}
        </div>

        <Separator />
        <div className="p-3 flex items-center justify-between">
          <Label htmlFor="show-popups" className="text-sm text-muted-foreground cursor-pointer">
            Show popup toasts
          </Label>
          <Switch
            id="show-popups"
            checked={showPopups}
            onCheckedChange={setShowPopups}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
