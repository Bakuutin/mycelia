import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSettingsStore } from "@/stores/settingsStore";
import { exchangeApiKeyForJWT } from "@/lib/auth";
import { Loader2, CheckCircle2, XCircle, Sparkles, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SetupStatus = "idle" | "connecting" | "creating" | "success" | "error" | "manual_entry" | "verifying";

interface SetupResponse {
  created: boolean;
  clientId?: string;
  clientSecret?: string;
  error?: string;
}

function getFriendlyAuthError(error: string | null): string {
  if (!error) return "Something went wrong. Please try again.";
  
  switch (error) {
    case "invalid_client":
      return "The Client ID or API Key you entered is incorrect. Please double-check your credentials and try again.";
    case "invalid_request":
      return "Missing required fields. Please enter both Client ID and API Key.";
    case "invalid_grant":
      return "Your authorization has expired. Please request new credentials.";
    default:
      if (error.includes("Failed to fetch") || error.includes("NetworkError")) {
        return "Could not reach the server. Make sure it's running and try again.";
      }
      return error;
  }
}

export default function SetupPage() {
  const navigate = useNavigate();
  const {
    apiEndpoint,
    clientId,
    clientSecret,
    setApiEndpoint,
    setClientId,
    setClientSecret,
  } = useSettingsStore();

  const [localEndpoint, setLocalEndpoint] = useState(apiEndpoint);
  const [manualClientId, setManualClientId] = useState("");
  const [manualClientSecret, setManualClientSecret] = useState("");
  const [status, setStatus] = useState<SetupStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Redirect if already configured
  useEffect(() => {
    if (clientId && clientSecret) {
      navigate("/setup/inference", { replace: true });
    }
  }, [clientId, clientSecret, navigate]);

  const runSetup = async () => {
    setStatus("connecting");

    try {
      // Save the endpoint first
      setApiEndpoint(localEndpoint);

      setStatus("creating");

      const response = await fetch(`${localEndpoint}/setup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data: SetupResponse = await response.json();

      if (data.created && data.clientId && data.clientSecret) {
        setClientId(data.clientId);
        setClientSecret(data.clientSecret);
        setErrorMessage(null);
        setStatus("success");

        // Redirect to inference setup after a short delay
        setTimeout(() => {
          navigate("/setup/inference", { replace: true });
        }, 1500);
      } else if (!data.created) {
        // API keys already exist, show manual entry form
        setErrorMessage(null);
        setStatus("manual_entry");
      }
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to connect to server"
      );
    }
  };

  const [verifyError, setVerifyError] = useState<string | null>(null);

  const verifyAndSaveCredentials = async () => {
    if (!manualClientId || !manualClientSecret) {
      return;
    }

    setStatus("verifying");

    try {
      const result = await exchangeApiKeyForJWT(
        localEndpoint,
        manualClientId,
        manualClientSecret
      );

      if (result.jwt) {
        // Credentials are valid, save them
        setClientId(manualClientId);
        setClientSecret(manualClientSecret);
        setVerifyError(null);
        setStatus("success");

        setTimeout(() => {
          navigate("/setup/inference", { replace: true });
        }, 1500);
      } else {
        // Invalid credentials
        setVerifyError(result.error || "Invalid credentials");
        setStatus("manual_entry");
      }
    } catch (error) {
      setVerifyError(error instanceof Error ? error.message : "Verification failed");
      setStatus("manual_entry");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo and Welcome */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">
            Welcome to Mycelia
          </h1>
          <p className="text-slate-300 text-lg">
            Your personal AI memory system
          </p>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-3 h-3 rounded-full bg-purple-400 ring-2 ring-purple-400/50" />
          <div className="w-8 h-0.5 bg-slate-600" />
          <div className="w-3 h-3 rounded-full bg-slate-600" />
        </div>

        {/* Setup Card */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20 shadow-2xl">
          {(status === "idle" || status === "error" || status === "connecting" || status === "creating") && (
            <form onSubmit={(e) => { e.preventDefault(); runSetup(); }}>
              {status === "error" && (
                <div className="mb-6 p-4 rounded-lg bg-red-500/20 border border-red-500/30">
                  <div className="flex items-start gap-3">
                    <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-red-300 font-medium">Connection Failed</p>
                      <p className="text-red-300/80 text-sm mt-1">{errorMessage}</p>
                      <p className="text-slate-400 text-sm mt-2">
                        The server might still be starting up. Give it a moment and try again.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-4 mb-6">
                <div>
                  <Label htmlFor="endpoint" className="text-slate-200 mb-2 block">
                    Server Endpoint
                  </Label>
                  <Input
                    id="endpoint"
                    type="url"
                    value={localEndpoint}
                    onChange={(e) => setLocalEndpoint(e.target.value)}
                    placeholder="http://localhost:5173"
                    disabled={status === "connecting" || status === "creating"}
                    className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus:border-purple-400 disabled:opacity-50"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={status === "connecting" || status === "creating"}
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-medium py-6 text-lg rounded-xl shadow-lg shadow-purple-500/30 transition-all hover:shadow-purple-500/50 disabled:opacity-80"
              >
                {(status === "connecting" || status === "creating") ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Connecting...
                  </>
                ) : status === "error" ? "Try Again" : "Start Setup"}
              </Button>
            </form>
          )}

          {status === "success" && (
            <div className="text-center py-8">
              <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
              <p className="text-white text-lg font-medium">
                API Key Created!
              </p>
              <p className="text-slate-400 text-sm mt-2">
                Continuing to next step...
              </p>
            </div>
          )}

          {(status === "manual_entry" || status === "verifying") && (
            <form onSubmit={(e) => { e.preventDefault(); verifyAndSaveCredentials(); }}>
              <div className="text-center mb-6">
                <KeyRound className="w-10 h-10 text-amber-400 mx-auto mb-3" />
                <p className="text-white text-lg font-medium">
                  Enter Your Credentials
                </p>
                <p className="text-slate-400 text-sm mt-1">
                  API keys already exist on this server
                </p>
              </div>

              {verifyError && (
                <div className="mb-4 p-4 rounded-lg bg-red-500/20 border border-red-500/30">
                  <div className="flex items-start gap-3">
                    <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-red-300 text-sm">{getFriendlyAuthError(verifyError)}</p>
                  </div>
                </div>
              )}

              <div className="space-y-4 mb-6">
                <div>
                  <Label htmlFor="manualClientId" className="text-slate-200 mb-2 block">
                    Client ID
                  </Label>
                  <Input
                    id="manualClientId"
                    type="text"
                    value={manualClientId}
                    onChange={(e) => setManualClientId(e.target.value)}
                    placeholder="Enter your client ID"
                    disabled={status === "verifying"}
                    className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus:border-purple-400 disabled:opacity-50"
                  />
                </div>
                <div>
                  <Label htmlFor="manualClientSecret" className="text-slate-200 mb-2 block">
                    Client Secret (API Key)
                  </Label>
                  <Input
                    id="manualClientSecret"
                    type="password"
                    value={manualClientSecret}
                    onChange={(e) => setManualClientSecret(e.target.value)}
                    placeholder="mycelia_..."
                    disabled={status === "verifying"}
                    className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus:border-purple-400 disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Button
                  type="submit"
                  disabled={!manualClientId || !manualClientSecret || status === "verifying"}
                  className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-medium py-6 text-lg rounded-xl shadow-lg shadow-purple-500/30 transition-all hover:shadow-purple-500/50 disabled:opacity-80"
                >
                  {status === "verifying" ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Verifying...
                    </>
                  ) : "Verify & Continue"}
                </Button>
                <Button
                  type="button"
                  onClick={() => setStatus("idle")}
                  disabled={status === "verifying"}
                  variant="ghost"
                  className="w-full text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-50"
                >
                  Back
                </Button>
              </div>
            </form>
          )}

        </div>

        
      </div>
    </div>
  );
}

