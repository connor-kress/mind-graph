import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";

type Props = {
  projectId?: Id<"projects">;
  projectName?: string;
  onClose: () => void;
  onCreated: (id: Id<"topics">) => void;
};

export function CreateMapDialog({ projectId, projectName, onClose, onCreated }: Props) {
  const createMap = useMutation(api.library.createMap);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting.current) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!pending}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => input.current?.focus());
        }}
        onEscapeKeyDown={(event) => {
          if (submitting.current) event.preventDefault();
        }}
      >
        <form
          className="space-y-5"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim() || submitting.current) return;
            submitting.current = true;
            setPending(true);
            setError(null);
            try {
              const topicId = await createMap({ projectId, title: name.trim() });
              onCreated(topicId);
              onClose();
            } catch (error) {
              setError(
                error instanceof ConvexError
                  ? String(error.data)
                  : "Couldn't create the map. Please try again.",
              );
            } finally {
              submitting.current = false;
              setPending(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Create map</DialogTitle>
            <DialogDescription>
              {projectName ? `In ${projectName}` : "A project will be created with this map."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="create-map-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              ref={input}
              id="create-map-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              autoComplete="off"
              disabled={pending}
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              {pending ? "Creating..." : "Create map"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
