import { useState, useEffect, useMemo } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
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

// Model categories with hints
const MODEL_CATEGORIES = [
  { value: "small", label: "Small", hint: "Fast & economical" },
  { value: "medium", label: "Medium", hint: "Balanced" },
  { value: "large", label: "Large", hint: "Most capable" },
];

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function ModelSelector({
  value,
  onChange,
  disabled = false,
  placeholder = "Select model...",
  className,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<{ id: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);

  // Fetch models when popover opens
  useEffect(() => {
    if (open && !loadedOnce) {
      const fetchModels = async () => {
        setLoading(true);
        try {
          const response = await callResource("llm", { action: "list" }) as {
            models: { id: string }[];
            categories: Record<string, { default: string; models: string[] }>;
          };
          setModels(response.models || []);
          setLoadedOnce(true);
        } catch (e) {
          console.error("Failed to fetch models:", e);
        } finally {
          setLoading(false);
        }
      };
      fetchModels();
    }
  }, [open, loadedOnce]);

  // Determine display label
  const displayLabel = useMemo(() => {
    if (!value) return placeholder;
    const category = MODEL_CATEGORIES.find((c) => c.value === value);
    if (category) return `${category.label} (${category.hint})`;
    return value;
  }, [value, placeholder]);

  const handleSelect = (selectedValue: string) => {
    onChange(selectedValue === value ? "" : selectedValue);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Loading models...
                </div>
              ) : (
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
                      value === category.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="font-medium">{category.label}</span>
                  <span className="ml-2 text-muted-foreground text-xs">
                    ({category.hint})
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>

            {/* Available Models from LiteLLM */}
            {models.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Available Models">
                  {models.map((model) => (
                    <CommandItem
                      key={model.id}
                      value={model.id}
                      onSelect={handleSelect}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === model.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="font-mono text-sm">{model.id}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {loading && models.length === 0 && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Loading models...</span>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
