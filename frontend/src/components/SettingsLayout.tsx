import { Link, Outlet, useLocation } from "react-router-dom";
import { Bot, Database, Key, Monitor, Palette, Settings, Flag, FileText, Shield, FileSearch, Server, Cog } from "lucide-react";

const SettingsLayout = () => {
  const location = useLocation();

  const clientSettings = [
    {
      name: "General",
      path: "/settings",
      icon: Palette,
      description: "Appearance and time format",
    },
    {
      name: "API",
      path: "/settings/api",
      icon: Key,
      description: "API configuration and authentication",
    },
  ];

  const serverSettings = [
    {
      name: "Inference",
      path: "/settings/inference",
      icon: Server,
      description: "Configure OpenAI-compatible inference provider",
    },
    {
      name: "API Keys",
      path: "/settings/api-keys",
      icon: Key,
      description: "Manage API keys and policies",
    },

    {
      name: "Configuration",
      path: "/settings/config",
      icon: Settings,
      description: "Manage server configuration",
    },
    {
      name: "Workers",
      path: "/settings/workers",
      icon: Cog,
      description: "Configure background job workers",
    },
  ];

  const administrationSettings = [
    {
      name: "Access Log",
      path: "/settings/access-log",
      icon: FileSearch,
      description: "View and audit access logs",
    },
    {
      name: "Feature Flags",
      path: "/settings/feature-flags",
      icon: Flag,
      description: "Enable or disable server features",
    },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Settings</h1>
      </div>

      <div className="flex gap-6">
        {/* Sidebar Navigation */}
        <div className="w-64 space-y-6">
          {/* Client Settings Section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Monitor className="w-3 h-3" />
              Client Settings
            </div>
            <div className="space-y-1">
              {clientSettings.map((tab) => {
                const Icon = tab.icon;
                const isActive = location.pathname === tab.path ||
                  (tab.path === "/settings" &&
                    location.pathname === "/settings");

                return (
                  <Link
                    key={tab.path}
                    to={tab.path}
                    className={`flex items-start gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-medium">{tab.name}</div>
                      <div className="text-xs opacity-70 mt-0.5">
                        {tab.description}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Server Settings Section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Database className="w-3 h-3" />
              Server Settings
            </div>
            <div className="space-y-1">
              {serverSettings.map((tab) => {
                const Icon = tab.icon;
                const isActive = location.pathname === tab.path || location.pathname.startsWith(tab.path);

                return (
                  <Link
                    key={tab.path}
                    to={tab.path}
                    className={`flex items-start gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-medium">{tab.name}</div>
                      <div className="text-xs opacity-70 mt-0.5">
                        {tab.description}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Administration Section */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Shield className="w-3 h-3" />
              Administration
            </div>
            <div className="space-y-1">
              {administrationSettings.map((tab) => {
                const Icon = tab.icon;
                const isActive = location.pathname === tab.path || location.pathname.startsWith(tab.path);

                return (
                  <Link
                    key={tab.path}
                    to={tab.path}
                    className={`flex items-start gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-medium">{tab.name}</div>
                      <div className="text-xs opacity-70 mt-0.5">
                        {tab.description}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default SettingsLayout;
