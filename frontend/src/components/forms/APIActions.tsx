import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Loader2, Save, Trash2, Key } from 'lucide-react';

interface APIActionsProps {
  hasChanges: boolean;
  isSaved: boolean;
  isExchanging: boolean;
  exchangeResult: 'success' | 'error' | null;
  canTest: boolean;
  onSave: () => void;
  onTestToken: () => void;
  onClear: () => void;
}

export function APIActions({
  hasChanges,
  isSaved,
  isExchanging,
  exchangeResult,
  canTest,
  onSave,
  onTestToken,
  onClear,
}: APIActionsProps) {
  return (
    <div className="flex items-center gap-3 pt-4 border-t">
      <Button
        onClick={onSave}
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
        onClick={onTestToken}
        disabled={isExchanging || !canTest}
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
        onClick={onClear}
        title="Clear all settings"
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );
}
