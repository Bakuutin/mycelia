import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSettingsStore } from "@/stores/settingsStore";
import { Loader2, CheckCircle2, XCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SetupStatus = "idle" | "connecting" | "creating" | "success" | "error" | "already_exists";

interface SetupResponse {
  created: boolean;
  clientId?: string;
  clientSecret?: string;
  error?: string;
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
    setErrorMessage(null);

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
        setStatus("success");

        // Redirect to inference setup after a short delay
        setTimeout(() => {
          navigate("/setup/inference", { replace: true });
        }, 1500);
      } else if (!data.created) {
        setStatus("already_exists");
        setErrorMessage(
          "API keys already exist on this server. Please enter your credentials manually in Settings."
        );
      }
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to connect to server"
      );
    }
  };

  const goToSettings = () => {
    navigate("/settings/api");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo and Welcome */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 mb-6 shadow-lg shadow-purple-500/30">
            <Sparkles className="w-10 h-10 text-white" />
          </div>
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
          {status === "idle" && (
            <>
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
                    className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus:border-purple-400"
                  />
                </div>
              </div>

              <Button
                onClick={runSetup}
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-medium py-6 text-lg rounded-xl shadow-lg shadow-purple-500/30 transition-all hover:shadow-purple-500/50"
              >
                Start Setup
              </Button>

              <p className="text-slate-400 text-sm text-center mt-4">
                This will create your first API key automatically
              </p>
            </>
          )}

          {(status === "connecting" || status === "creating") && (
            <div className="text-center py-8">
              <Loader2 className="w-12 h-12 text-purple-400 animate-spin mx-auto mb-4" />
              <p className="text-white text-lg font-medium">
                {status === "connecting" ? "Connecting to server..." : "Creating your API key..."}
              </p>
              <p className="text-slate-400 text-sm mt-2">
                Please wait a moment
              </p>
            </div>
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

          {(status === "error" || status === "already_exists") && (
            <div className="text-center py-4">
              <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <p className="text-white text-lg font-medium mb-2">
                {status === "already_exists" ? "Server Already Configured" : "Setup Failed"}
              </p>
              <p className="text-slate-400 text-sm mb-6">
                {errorMessage}
              </p>
              <div className="flex gap-3">
                <Button
                  onClick={() => setStatus("idle")}
                  variant="outline"
                  className="flex-1 border-white/20 text-white hover:bg-white/10"
                >
                  Try Again
                </Button>
                <Button
                  onClick={goToSettings}
                  className="flex-1 bg-purple-500 hover:bg-purple-600 text-white"
                >
                  Go to Settings
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-slate-500 text-xs text-center mt-6">
          Step 1 of 2 - Server Connection
        </p>
      </div>
    </div>
  );
}

