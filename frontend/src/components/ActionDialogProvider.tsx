import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ActionDialogOptions = {
  title: string;
  description: string;
  actionLabel?: string;
  destructive?: boolean;
};

type PromptDialogOptions = ActionDialogOptions & {
  confirmationPhrase?: string;
  inputLabel?: string;
  placeholder?: string;
};

type PendingRequest =
  | (
    & { kind: "confirm"; resolve: (value: boolean) => void }
    & ActionDialogOptions
  )
  | (
    & { kind: "prompt"; resolve: (value: string | null) => void }
    & PromptDialogOptions
  );

type ActionDialogContextValue = {
  confirmAction: (options: ActionDialogOptions) => Promise<boolean>;
  promptAction: (options: PromptDialogOptions) => Promise<string | null>;
};

const ActionDialogContext = createContext<ActionDialogContextValue | null>(
  null,
);

export function ActionDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const [input, setInput] = useState("");

  const value = useMemo<ActionDialogContextValue>(() => ({
    confirmAction: (options) =>
      new Promise<boolean>((resolve) => {
        setInput("");
        setRequest({ kind: "confirm", ...options, resolve });
      }),
    promptAction: (options) =>
      new Promise<string | null>((resolve) => {
        setInput("");
        setRequest({ kind: "prompt", ...options, resolve });
      }),
  }), []);

  const cancel = () => {
    if (!request) return;
    if (request.kind === "confirm") request.resolve(false);
    else request.resolve(null);
    setRequest(null);
    setInput("");
  };

  const confirm = () => {
    if (!request) return;
    if (request.kind === "prompt") {
      request.resolve(input);
    } else {
      request.resolve(true);
    }
    setRequest(null);
    setInput("");
  };

  const phraseMatches = request?.kind !== "prompt" ||
    !request.confirmationPhrase || input === request.confirmationPhrase;

  return (
    <ActionDialogContext.Provider value={value}>
      {children}
      <Dialog
        open={Boolean(request)}
        onOpenChange={(open) => !open && cancel()}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{request?.title}</DialogTitle>
            <DialogDescription className="whitespace-pre-line">
              {request?.description}
            </DialogDescription>
          </DialogHeader>
          {request?.kind === "prompt" && (
            <div className="space-y-2">
              <Label htmlFor="action-dialog-input">
                {request.inputLabel ?? (request.confirmationPhrase
                  ? `Type ${request.confirmationPhrase} to confirm`
                  : "Value")}
              </Label>
              <Input
                id="action-dialog-input"
                autoFocus
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={request.placeholder ?? request.confirmationPhrase}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={cancel} autoFocus>
              Cancel
            </Button>
            <Button
              variant={request?.destructive ? "destructive" : "default"}
              disabled={!phraseMatches}
              onClick={confirm}
            >
              {request?.actionLabel ?? "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ActionDialogContext.Provider>
  );
}

export function useActionDialog() {
  const context = useContext(ActionDialogContext);
  if (!context) {
    throw new Error("useActionDialog must be used within ActionDialogProvider");
  }
  return context;
}
