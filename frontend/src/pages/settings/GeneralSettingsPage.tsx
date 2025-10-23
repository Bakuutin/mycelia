import { useState, useMemo } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Moon, Sun, Monitor } from 'lucide-react';
import { formatTime } from '@/lib/formatTime';

const GeneralSettingsPage = () => {
  const { theme, timeFormat, setTheme, setTimeFormat } = useSettingsStore();
  const now = useMemo(() => new Date(), []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Appearance</h2>
        <p className="text-muted-foreground">
          Choose how Mycelia looks on this device.
        </p>
      </div>

      <div className="border rounded-lg p-6 space-y-6">
        <div className="space-y-4">
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
    </div>
  );
};

export default GeneralSettingsPage;
