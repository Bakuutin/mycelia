import { Link, Outlet, useLocation } from "react-router-dom";
import { Clock, Home, Package, Settings } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { TooltipProvider } from "@/components/ui/tooltip";

const Layout = () => {
  useTheme();
  const location = useLocation();

  const navigation = [
    { name: "Timeline", path: "/timeline", icon: Clock },
    { name: "Objects", path: "/objects", icon: Package },
    { name: "Settings", path: "/settings", icon: Settings },
  ];

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <nav className="border-b">
          <div className="container mx-auto px-4">
            <div className="flex h-16 items-center justify-between">
              <div className="flex items-center gap-6">
                <Link to="/" className="text-xl font-bold">
                  Mycelia
                </Link>
                <div className="flex gap-4">
                  {navigation.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.path;
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {item.name}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </nav>
        <main className="container mx-auto px-4 py-6">
          <Outlet />
        </main>
      </div>
    </TooltipProvider>
  );
};

export default Layout;
