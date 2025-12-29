import { useState } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { exchangeApiKeyForJWT } from "@/lib/auth";
import { APIEndpointField } from "@/components/forms/APIEndpointField";
import { ClientCredentialsFields } from "@/components/forms/ClientCredentialsFields";
import { APIActions } from "@/components/forms/APIActions";
import { Info, Terminal, AlertTriangle, CheckCircle2 } from "lucide-react";

const APISettingsPage = () => {
  const {
    apiEndpoint,
    clientId,
    clientSecret,
    setApiEndpoint,
    setClientId,
    setClientSecret,
    clearSettings,
  } = useSettingsStore();
  const [localEndpoint, setLocalEndpoint] = useState(apiEndpoint);
  const [localClientId, setLocalClientId] = useState(clientId);
  const [localClientSecret, setLocalClientSecret] = useState(clientSecret);
  const [isSaved, setIsSaved] = useState(false);
  const [isExchanging, setIsExchanging] = useState(false);
  const [exchangeResult, setExchangeResult] = useState<
    "success" | "error" | null
  >(null);

  const handleSave = () => {
    setApiEndpoint(localEndpoint);
    setClientId(localClientId);
    setClientSecret(localClientSecret);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleClear = () => {
    if (confirm("Are you sure you want to clear all settings?")) {
      clearSettings();
      setLocalEndpoint(useSettingsStore.getState().apiEndpoint);
      setLocalClientId("");
      setLocalClientSecret("");
      setExchangeResult(null);
    }
  };

  const handleExchangeToken = async () => {
    setIsExchanging(true);
    setExchangeResult(null);

    try {
      const result = await exchangeApiKeyForJWT(
        localEndpoint,
        localClientId,
        localClientSecret,
      );
      if (result.jwt) {
        setExchangeResult("success");
      } else {
        setExchangeResult("error");
      }
    } catch {
      setExchangeResult("error");
    } finally {
      setIsExchanging(false);
    }
  };

  const hasChanges = localEndpoint !== apiEndpoint ||
    localClientId !== clientId || localClientSecret !== clientSecret;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">API Configuration</h2>
        <p className="text-muted-foreground">
          Configure your backend API endpoint and authentication token. These
          settings are stored locally in your browser.
        </p>
      </div>

      <div className="border rounded-lg p-6 space-y-6">
        <div className="space-y-4">
          <APIEndpointField
            value={localEndpoint}
            onChange={setLocalEndpoint}
          />

          <ClientCredentialsFields
            clientId={localClientId}
            clientSecret={localClientSecret}
            onClientIdChange={setLocalClientId}
            onClientSecretChange={setLocalClientSecret}
          />
        </div>

        <APIActions
          hasChanges={hasChanges}
          isSaved={isSaved}
          isExchanging={isExchanging}
          exchangeResult={exchangeResult}
          canTest={!!localClientId && !!localClientSecret && !!localEndpoint}
          onSave={handleSave}
          onTestToken={handleExchangeToken}
          onClear={handleClear}
        />

        {/* Token test result feedback */}
        {exchangeResult === "error" && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium text-red-600 dark:text-red-400">Token validation failed</p>
              <p className="text-sm text-muted-foreground">
                The credentials could not be verified. This could mean:
              </p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1 mt-2">
                <li>The backend server is not running</li>
                <li>The Client ID or Client Secret is incorrect</li>
                <li>The API key has been revoked or expired</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-2">
                See the setup instructions below to generate new credentials.
              </p>
            </div>
          </div>
        )}

        {exchangeResult === "success" && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-green-600 dark:text-green-400">Token is valid</p>
              <p className="text-sm text-muted-foreground">
                Your credentials are working correctly. You can now use the Timeline, Objects, and other features.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Setup instructions - always visible */}
      <div className="border border-blue-500/30 bg-blue-500/5 rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
          <Info className="h-5 w-5" />
          <h3 className="font-semibold">How to get your API credentials</h3>
        </div>

        <div className="space-y-4 text-sm">
          <div className="flex gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium">
              1
            </div>
            <div className="space-y-2">
              <p className="font-medium">Start the backend server</p>
              <p className="text-muted-foreground">
                On first run, credentials are automatically generated and saved to <code className="bg-muted px-1.5 py-0.5 rounded text-xs">.env</code>
              </p>
              <div className="bg-zinc-900 text-zinc-100 rounded-md p-3 font-mono text-xs mt-2">
                <div className="flex items-center gap-2 text-zinc-400 mb-2">
                  <Terminal className="h-3 w-3" />
                  <span>Terminal</span>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap">
{`cd backend
cp .env.example .env  # first time only
deno task dev`}
                </pre>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium">
              2
            </div>
            <div className="space-y-2">
              <p className="font-medium">Find the credentials in the backend console</p>
              <p className="text-muted-foreground">
                Look for these lines in the terminal output:
              </p>
              <div className="bg-zinc-900 text-zinc-100 rounded-md p-3 font-mono text-xs mt-2">
                <pre className="overflow-x-auto whitespace-pre-wrap">
{`[AutoInit] ✅ Credentials auto-configured:
  MYCELIA_TOKEN=mycelia_xxxxx...
  MYCELIA_CLIENT_ID=xxxxxx...`}
                </pre>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium">
              3
            </div>
            <div className="space-y-2">
              <p className="font-medium">Enter the values above</p>
              <ul className="text-muted-foreground space-y-1">
                <li><strong>Client ID</strong> → paste the <code className="bg-muted px-1.5 py-0.5 rounded text-xs">MYCELIA_CLIENT_ID</code> value</li>
                <li><strong>Client Secret</strong> → paste the <code className="bg-muted px-1.5 py-0.5 rounded text-xs">MYCELIA_TOKEN</code> value</li>
              </ul>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-medium">
              4
            </div>
            <div className="space-y-2">
              <p className="font-medium">Save and test</p>
              <p className="text-muted-foreground">
                Click <strong>Save Settings</strong>, then <strong>Test Token</strong> to verify the connection.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-blue-500/20 mt-4">
          <p className="text-xs text-muted-foreground">
            <strong>Tip:</strong> If you need to generate new credentials manually, run: <code className="bg-muted px-1.5 py-0.5 rounded">deno run -A --env server.ts token-create</code>
          </p>
        </div>
      </div>
    </div>
  );
};

export default APISettingsPage;
