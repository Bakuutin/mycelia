import { AlertCircle, Settings, Terminal, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSettingsStore } from "@/stores/settingsStore";

interface ApiCredentialsErrorProps {
  error: string;
}

/**
 * Displays a helpful error message when API authentication fails (403 Forbidden).
 * Shows setup instructions for users who haven't configured their credentials.
 */
export function ApiCredentialsError({ error }: ApiCredentialsErrorProps) {
  const { clientId, clientSecret, apiEndpoint } = useSettingsStore();
  const isMissingCredentials = !clientId || !clientSecret;
  const is403Error = error.includes("403") || error.includes("Forbidden");

  // If it's not a 403 error or credentials are set, show generic error
  if (!is403Error && !isMissingCredentials) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Connection Error</p>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-500/50 bg-amber-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
          <AlertCircle className="h-5 w-5" />
          API Credentials Required
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The backend returned <code className="bg-muted px-1.5 py-0.5 rounded text-xs">403 Forbidden</code>.
          This usually means API credentials are missing or invalid.
        </p>

        {isMissingCredentials && (
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium">Current Settings:</p>
            <div className="text-xs font-mono space-y-1">
              <div className="flex gap-2">
                <span className="text-muted-foreground">API Endpoint:</span>
                <span>{apiEndpoint || "(not set)"}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground">Client ID:</span>
                <span className={!clientId ? "text-amber-600" : ""}>
                  {clientId || "(not set)"}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground">Client Secret:</span>
                <span className={!clientSecret ? "text-amber-600" : ""}>
                  {clientSecret ? "••••••••" : "(not set)"}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <p className="text-sm font-medium">How to fix:</p>

          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">
                1
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Start the backend server</p>
                <p className="text-xs text-muted-foreground">
                  On first run, credentials are auto-generated and saved to <code className="bg-muted px-1 py-0.5 rounded">.env</code>
                </p>
                <div className="bg-zinc-900 text-zinc-100 rounded-md p-3 text-xs font-mono mt-2">
                  <div className="flex items-center gap-2 text-zinc-400 mb-1">
                    <Terminal className="h-3 w-3" />
                    <span>Terminal</span>
                  </div>
                  <pre className="overflow-x-auto">
{`cd backend
cp .env.example .env  # first time only
deno task dev`}
                  </pre>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">
                2
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Copy credentials from backend output</p>
                <p className="text-xs text-muted-foreground">
                  Look for these lines in the backend console:
                </p>
                <div className="bg-zinc-900 text-zinc-100 rounded-md p-3 text-xs font-mono mt-2 overflow-x-auto">
                  <pre>
{`[AutoInit] ✅ Credentials auto-configured:
  MYCELIA_TOKEN=mycelia_xxxxx...
  MYCELIA_CLIENT_ID=xxxxxx...`}
                  </pre>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-medium">
                3
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Enter credentials in Settings</p>
                <p className="text-xs text-muted-foreground">
                  Go to Settings and enter:
                </p>
                <ul className="text-xs text-muted-foreground list-disc list-inside mt-1">
                  <li><strong>Client ID</strong> → the <code className="bg-muted px-1 py-0.5 rounded">MYCELIA_CLIENT_ID</code> value</li>
                  <li><strong>Client Secret</strong> → the <code className="bg-muted px-1 py-0.5 rounded">MYCELIA_TOKEN</code> value</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button asChild>
            <Link to="/settings/api">
              <Settings className="h-4 w-4 mr-2" />
              Go to Settings
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <a
              href="https://github.com/your-org/mycelia#readme"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              View README
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Check if an error is likely an authentication/credentials issue
 */
export function isCredentialsError(error: string | null | undefined): boolean {
  if (!error) return false;
  return error.includes("403") || error.includes("Forbidden") || error.includes("Unauthorized");
}
