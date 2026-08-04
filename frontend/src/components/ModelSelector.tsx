import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { callResource } from "@/lib/api";
import { extractModelIds } from "@/lib/inferenceModels";

// Model categories with hints
const MODEL_CATEGORIES = [
  { value: "small", label: "Small", hint: "Fast & economical" },
  { value: "medium", label: "Medium", hint: "Balanced" },
  { value: "large", label: "Large", hint: "Most capable" },
];

type ProviderListing = {
  id: string;
  name: string;
  enabled?: boolean;
  priority?: number;
  models?: string[];
  error?: string;
};

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  prefetch?: boolean;
  availableModels?: string[];
  // Chat-style selection: group models under their provider and report which
  // provider the chosen model should be pinned to. Aliases report undefined
  // (routing picks the best provider automatically).
  groupByProvider?: boolean;
  providerValue?: string;
  onSelectWithProvider?: (model: string, providerProfileId?: string) => void;
}

export function ModelSelector({
  value,
  onChange,
  disabled = false,
  placeholder = "Select model...",
  className,
  prefetch = false,
  availableModels,
  groupByProvider = false,
  providerValue,
  onSelectWithProvider,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [providerListings, setProviderListings] = useState<ProviderListing[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await callResource("llm", { action: "list" }) as {
        models?: unknown;
        providers?: ProviderListing[];
      };
      setModels(extractModelIds(response.models));
      setProviderListings(
        Array.isArray(response.providers)
          ? response.providers.filter((provider) => provider.enabled !== false)
          : [],
      );
      setLoadedOnce(true);
    } catch (e) {
      console.error("Failed to fetch models:", e);
      setLoadError(e instanceof Error ? e.message : "Failed to fetch models");
    } finally {
      setLoading(false);
    }
  }, []);

  // Summarization dialogs prefetch whenever they open so provider changes are
  // reflected before the user opens the model picker.
  useEffect(() => {
    if (prefetch) {
      void fetchModels();
    }
  }, [prefetch, fetchModels]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    // Other screens keep lazy loading. A new open also provides an explicit
    // retry after an earlier provider error.
    if (nextOpen && !loading && (!loadedOnce || loadError)) {
      void fetchModels();
    }
  };

  // Determine display label
  const displayLabel = useMemo(() => {
    if (!value) return placeholder;
    const category = MODEL_CATEGORIES.find((c) => c.value === value);
    if (category) return `${category.label} (${category.hint})`;
    const pinnedProvider = providerValue
      ? providerListings.find((provider) => provider.id === providerValue)
      : undefined;
    return pinnedProvider ? `${value} @ ${pinnedProvider.name}` : value;
  }, [value, placeholder, providerValue, providerListings]);

  const visibleModels = useMemo(
    () => [...new Set([...(availableModels || []), ...models])],
    [availableModels, models],
  );

  const handleSelect = (selectedValue: string) => {
    const next = selectedValue === value ? "" : selectedValue;
    onChange(next);
    onSelectWithProvider?.(next, undefined);
    setOpen(false);
  };

  const handleSelectFromProvider = (
    selectedValue: string,
    providerProfileId: string,
  ) => {
    const samePick = selectedValue === value &&
      providerProfileId === providerValue;
    onChange(samePick ? "" : selectedValue);
    onSelectWithProvider?.(
      samePick ? "" : selectedValue,
      samePick ? undefined : providerProfileId,
    );
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", className)}
          disabled={disabled}
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models..." />
          <CommandList>
            <CommandEmpty>
              {loading
                ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Loading models...
                  </div>
                )
                : (
                  "No model found."
                )}
            </CommandEmpty>

            {/* Categories */}
            <CommandGroup heading="Categories">
              {MODEL_CATEGORIES.map((category) => (
                <CommandItem
                  key={category.value}
                  value={category.value}
                  onSelect={handleSelect}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === category.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="font-medium">{category.label}</span>
                  <span className="ml-2 text-muted-foreground text-xs">
                    ({category.hint})
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>

            {/* Provider-grouped models: picking one pins the provider. */}
            {groupByProvider && providerListings.length > 0 &&
              providerListings.map((provider) => (
                (provider.models?.length ?? 0) > 0 && (
                  <CommandGroup
                    key={provider.id}
                    heading={`${provider.name}`}
                  >
                    {provider.models!.map((model) => (
                      <CommandItem
                        key={`${provider.id}:${model}`}
                        value={`${provider.name} ${model}`}
                        onSelect={() =>
                          handleSelectFromProvider(model, provider.id)}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            value === model && providerValue === provider.id
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                        <span className="font-mono text-sm">{model}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )
              ))}

            {/* Available Models from LiteLLM */}
            {!groupByProvider && visibleModels.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Available Models">
                  {visibleModels.map((model) => (
                    <CommandItem
                      key={model}
                      value={model}
                      onSelect={handleSelect}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === model ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="font-mono text-sm">{model}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {loading && models.length === 0 && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">
                  Loading models...
                </span>
              </div>
            )}

            {loadError && !loading && (
              <div className="flex items-start gap-2 border-t px-3 py-3 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Could not load provider models: {loadError}</span>
              </div>
            )}

            {!loading && !loadError && loadedOnce && models.length === 0 && (
              <div className="border-t px-3 py-3 text-xs text-muted-foreground">
                The provider returned no named models. You can still use a
                configured alias.
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
