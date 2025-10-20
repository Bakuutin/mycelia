import { useSettingsStore } from '@/stores/settingsStore';

export interface TokenExchangeResponse {
  jwt: string | null;
  error: string | null;
}

export async function exchangeApiKeyForJWT(
  apiEndpoint: string,
  clientId: string,
  clientSecret: string
): Promise<TokenExchangeResponse> {
  try {
    const response = await fetch(`${apiEndpoint}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return { jwt: null, error: data.error || 'Failed to exchange token' };
    }

    const data = await response.json();
    return { jwt: data.access_token, error: null };
  } catch (error) {
    return { jwt: null, error: String(error) };
  }
}

export async function getCurrentJWT(): Promise<string | null> {
  const { apiEndpoint, clientId, clientSecret } = useSettingsStore.getState();

  if (!clientId || !clientSecret) {
    return null;
  }

  const result = await exchangeApiKeyForJWT(apiEndpoint, clientId, clientSecret);
  return result.jwt;
}
