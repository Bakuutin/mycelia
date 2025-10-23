import { useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { exchangeApiKeyForJWT } from '@/lib/auth';
import { APIEndpointField } from '@/components/forms/APIEndpointField';
import { ClientCredentialsFields } from '@/components/forms/ClientCredentialsFields';
import { APIActions } from '@/components/forms/APIActions';

const APISettingsPage = () => {
  const { apiEndpoint, clientId, clientSecret, setApiEndpoint, setClientId, setClientSecret, clearSettings } = useSettingsStore();
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
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">API Configuration</h2>
        <p className="text-muted-foreground">
          Configure your backend API endpoint and authentication token. These settings are stored locally in your browser.
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
      </div>
    </div>
  );
};

export default APISettingsPage;
