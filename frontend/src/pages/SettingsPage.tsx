import { useState, useMemo } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { exchangeApiKeyForJWT } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckCircle2, XCircle, Loader2, Save, Trash2, Moon, Sun, Monitor, Key } from 'lucide-react';
import { formatTime } from '@/lib/formatTime';

const SettingsPage = () => {
  const { apiEndpoint, clientId, clientSecret, theme, timeFormat, setApiEndpoint, setClientId, setClientSecret, setTheme, setTimeFormat, clearSettings } = useSettingsStore();
  const now = useMemo(() => new Date(), []);
  const [localEndpoint, setLocalEndpoint] = useState(apiEndpoint);
  const [localClientId, setLocalClientId] = useState(clientId);
  const [localClientSecret, setLocalClientSecret] = useState(clientSecret);
  const [isSaved, setIsSaved] = useState(false);
  const [isExchanging, setIsExchanging] = useState(false);
  const [exchangeResult, setExchangeResult] = useState<'success' | 'error' | null>(null);

  const handleSave = () => {
    setApiEndpoint(localEndpoint);
    setClientId(localClientId);
    setClientSecret(localClientSecret);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleClear = () => {
    if (confirm('Are you sure you want to clear all settings?')) {
      clearSettings();
      setLocalEndpoint(useSettingsStore.getState().apiEndpoint);
      setLocalClientId('');
      setLocalClientSecret('');
      setExchangeResult(null);
    }
  };

  const handleExchangeToken = async () => {
    setIsExchanging(true);
    setExchangeResult(null);

    try {
      const result = await exchangeApiKeyForJWT(localEndpoint, localClientId, localClientSecret);
      if (result.jwt) {
        setExchangeResult('success');
      } else {
        setExchangeResult('error');
      }
    } catch {
      setExchangeResult('error');
    } finally {
      setIsExchanging(false);
    }
  };

  const hasChanges = localEndpoint !== apiEndpoint || localClientId !== clientId || localClientSecret !== clientSecret;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Settings</h1>
      </div>

      <div className="border rounded-lg p-6 space-y-6">
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold mb-4">Appearance</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Choose how Mycelia looks to you.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Theme</Label>
            <div className="flex gap-3">
              <Button
                variant={theme === 'light' ? 'default' : 'outline'}
                onClick={() => setTheme('light')}
                className="flex-1"
              >
                <Sun className="w-4 h-4 mr-2" />
                Light
              </Button>
              <Button
                variant={theme === 'dark' ? 'default' : 'outline'}
                onClick={() => setTheme('dark')}
                className="flex-1"
              >
                <Moon className="w-4 h-4 mr-2" />
                Dark
              </Button>
              <Button
                variant={theme === 'system' ? 'default' : 'outline'}
                onClick={() => setTheme('system')}
                className="flex-1"
              >
                <Monitor className="w-4 h-4 mr-2" />
                System
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Select your preferred theme or use system settings
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timeFormat">Time Format</Label>
            <select
              id="timeFormat"
              value={timeFormat}
              onChange={(e) => setTimeFormat(e.target.value as any)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <optgroup label="Gregorian (Local)">
                <option value="gregorian-local-iso">ISO 8601 ({formatTime(now, 'gregorian-local-iso')})</option>
                <option value="gregorian-local-verbose">Verbose ({formatTime(now, 'gregorian-local-verbose')})</option>
                <option value="gregorian-local-european">European ({formatTime(now, 'gregorian-local-european')})</option>
                <option value="gregorian-local-american">American ({formatTime(now, 'gregorian-local-american')})</option>
              </optgroup>
              <optgroup label="Gregorian (UTC)">
                <option value="gregorian-utc-iso">ISO 8601 UTC ({formatTime(now, 'gregorian-utc-iso')})</option>
                <option value="gregorian-utc-verbose">Verbose UTC ({formatTime(now, 'gregorian-utc-verbose')})</option>
                <option value="gregorian-utc-european">European UTC ({formatTime(now, 'gregorian-utc-european')})</option>
                <option value="gregorian-utc-american">American UTC ({formatTime(now, 'gregorian-utc-american')})</option>
              </optgroup>
              <optgroup label="SI Time">
                <option value="si-int">Seconds since epoch ({formatTime(now, 'si-int')})</option>
                <option value="si-formatted">Formatted SI ({formatTime(now, 'si-formatted')})</option>
              </optgroup>
            </select>
            <p className="text-xs text-muted-foreground">
              Choose how dates and times are displayed across the application
            </p>
          </div>
        </div>
      </div>

      <div className="border rounded-lg p-6 space-y-6">
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold mb-4">API Configuration</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Configure your backend API endpoint and authentication token. These settings are stored locally in your browser.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiEndpoint">API Endpoint</Label>
            <Input
              id="apiEndpoint"
              type="url"
              placeholder="http://localhost:8000"
              value={localEndpoint}
              onChange={(e) => setLocalEndpoint(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The base URL of your Mycelia backend server
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientId">Client ID</Label>
            <Input
              id="clientId"
              type="text"
              placeholder="MongoDB ObjectId"
              value={localClientId}
              onChange={(e) => setLocalClientId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The ObjectId of your API key (logged when token is created)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientSecret">Client Secret</Label>
            <Input
              id="clientSecret"
              type="password"
              placeholder="mycelia_..."
              value={localClientSecret}
              onChange={(e) => setLocalClientSecret(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Your API key (starts with mycelia_)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4 border-t">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaved}
          >
            {isSaved ? (
              <>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Saved
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Settings
              </>
            )}
          </Button>

          <Button
            variant="outline"
            onClick={handleExchangeToken}
            disabled={isExchanging || !localClientId || !localClientSecret || !localEndpoint}
          >
            {isExchanging ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Exchanging...
              </>
            ) : (
              <>
                <Key className="w-4 h-4 mr-2" />
                Test Token
              </>
            )}
          </Button>

          <div className="flex flex-col gap-2 ml-auto">
            {exchangeResult && (
              <div className="flex items-center gap-2">
                {exchangeResult === 'success' ? (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <span className="text-sm text-green-600">Token valid</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-5 h-5 text-red-600" />
                    <span className="text-sm text-red-600">Token invalid</span>
                  </>
                )}
              </div>
            )}
          </div>

          <Button
            variant="destructive"
            size="icon"
            onClick={handleClear}
            title="Clear all settings"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
