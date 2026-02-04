import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader2, UserRound, FlaskConical } from "lucide-react";
import { toast } from "sonner";

interface ServerConfig {
  features: {
    enable_experimental_processing?: boolean;
    enable_speaker_identification?: boolean;
  };
}

const FeatureFlagsPage = () => {
  const queryClient = useQueryClient();

  // Fetch current config
  const { data: config, isLoading } = useQuery({
    queryKey: ["server_config"],
    queryFn: async () => {
      const response = await api.get<{ data: ServerConfig }>("/resource/config", {
        params: { action: "get" }
      });
      return response.data.data;
    },
  });

  // Update config mutation
  const updateMutation = useMutation({
    mutationFn: async (features: ServerConfig["features"]) => {
      await api.post("/resource/config", {
        action: "update",
        data: { features },
      });
    },
    onSuccess: () => {
      toast.success("Feature flag updated");
      queryClient.invalidateQueries({ queryKey: ["server_config"] });
    },
    onError: (error: Error) => {
      toast.error("Failed to update", { description: error.message });
    },
  });

  const handleToggle = (key: keyof ServerConfig["features"], value: boolean) => {
    const newFeatures = {
      ...config?.features,
      [key]: value,
    };
    updateMutation.mutate(newFeatures);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold mb-2">Feature Flags</h2>
        <p className="text-muted-foreground">
          Enable or disable experimental features.
        </p>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <UserRound className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Speaker Identification</CardTitle>
                  <CardDescription>
                    Recognize enrolled voices in diarization results
                  </CardDescription>
                </div>
              </div>
              <Switch
                checked={config?.features?.enable_speaker_identification ?? false}
                onCheckedChange={(checked) => handleToggle("enable_speaker_identification", checked)}
                disabled={updateMutation.isPending}
              />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">
              When enabled, the diarization process will match audio segments against enrolled speaker profiles 
              and automatically label them in transcripts. Enroll voices in Settings → Voice Profiles.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <FlaskConical className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Experimental Processing</CardTitle>
                  <CardDescription>
                    Enable experimental conversation processing
                  </CardDescription>
                </div>
              </div>
              <Switch
                checked={config?.features?.enable_experimental_processing ?? false}
                onCheckedChange={(checked) => handleToggle("enable_experimental_processing", checked)}
                disabled={updateMutation.isPending}
              />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">
              Enable experimental features for conversation processing. These features are in development 
              and may not work as expected.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default FeatureFlagsPage;
