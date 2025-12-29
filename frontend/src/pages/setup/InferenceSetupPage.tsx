import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSettingsStore } from "@/stores/settingsStore";
import { callResource } from "@/lib/api";
import { Loader2, CheckCircle2, XCircle, Cpu, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SetupStatus = "idle" | "saving" | "success" | "error";

const SERVER_CONFIG_ID = "000000000000000000000000";

export default function InferenceSetupPage() {
  const navigate = useNavigate();
  const { clientId, clientSecret } = useSettingsStore();

  const [baseUrl, setBaseUrl] = useState("https://inference.mycelia.tech");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<SetupStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Redirect to main setup if no credentials
  if (!clientId || !clientSecret) {
    navigate("/setup", { replace: true });
    return null;
  }

  const saveInferenceConfig = async () => {
    setStatus("saving");
    setErrorMessage(null);

    try {
      // First ensure the config document exists
      const existing = await callResource("mongo", {
        action: "findOne",
        collection: "configs",
        query: { _id: { $oid: SERVER_CONFIG_ID } },
      });

      if (!existing) {
        // Create the config document if it doesn't exist
        await callResource("mongo", {
          action: "insertOne",
          collection: "configs",
          doc: {
            _id: { $oid: SERVER_CONFIG_ID },
            inference: {
              baseUrl,
              apiKey,
            },
          },
        });
      } else {
        // Update the existing config
        await callResource("mongo", {
          action: "updateOne",
          collection: "configs",
          query: { _id: { $oid: SERVER_CONFIG_ID } },
          update: {
            $set: {
              inference: {
                baseUrl,
                apiKey,
              },
            },
          },
        });
      }

      setStatus("success");

      // Redirect after a short delay
      setTimeout(() => {
        navigate("/", { replace: true });
      }, 1500);
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to save configuration"
      );
    }
  };

  const skipSetup = () => {
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 mb-6 shadow-lg shadow-cyan-500/30">
            <Cpu className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">
            Inference Provider
          </h1>
          <p className="text-slate-300 text-lg">
            Configure your AI inference backend
          </p>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-3 h-3 rounded-full bg-green-400" />
          <div className="w-8 h-0.5 bg-green-400" />
          <div className="w-3 h-3 rounded-full bg-purple-400 ring-2 ring-purple-400/50" />
        </div>

        {/* Setup Card */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 border border-white/20 shadow-2xl">
          {status === "idle" && (
            <>
              <div className="space-y-4 mb-6">
                <div>
                  <Label htmlFor="baseUrl" className="text-slate-200 mb-2 block">
                    Inference API URL
                  </Label>
                  <Input
                    id="baseUrl"
                    type="url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://inference.mycelia.tech"
                    className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus:border-cyan-400"
                  />
                  <p className="text-slate-400 text-xs mt-1">
                    OpenAI-compatible inference endpoint
                  </p>
                </div>

                <div>
                  <Label htmlFor="apiKey" className="text-slate-200 mb-2 block">
                    API Key
                  </Label>
                  <Input
                    id="apiKey"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter your API key"
                    className="bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus:border-cyan-400"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Button
                  onClick={saveInferenceConfig}
                  disabled={!baseUrl}
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-medium py-6 text-lg rounded-xl shadow-lg shadow-cyan-500/30 transition-all hover:shadow-cyan-500/50"
                >
                  Save & Continue
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>

                <Button
                  onClick={skipSetup}
                  variant="ghost"
                  className="w-full text-slate-400 hover:text-white hover:bg-white/10"
                >
                  Skip for now
                </Button>
              </div>

              <p className="text-slate-400 text-sm text-center mt-4">
                You can change this later in Settings
              </p>
            </>
          )}

          {status === "saving" && (
            <div className="text-center py-8">
              <Loader2 className="w-12 h-12 text-cyan-400 animate-spin mx-auto mb-4" />
              <p className="text-white text-lg font-medium">
                Saving configuration...
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
                Configuration Saved!
              </p>
              <p className="text-slate-400 text-sm mt-2">
                Redirecting to your dashboard...
              </p>
            </div>
          )}

          {status === "error" && (
            <div className="text-center py-4">
              <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <p className="text-white text-lg font-medium mb-2">
                Configuration Failed
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
                  onClick={skipSetup}
                  className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-white"
                >
                  Skip for now
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-slate-500 text-xs text-center mt-6">
          Step 2 of 2 - Inference Configuration
        </p>
      </div>
    </div>
  );
}

