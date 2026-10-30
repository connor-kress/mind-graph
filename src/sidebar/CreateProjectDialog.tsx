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
  onClose: () => void;
  onCreated: (id: Id<"projects">) => void;
};

export function CreateProjectDialog({ onClose, onCreated }: Props) {
  const createProject = useMutation(api.library.createProject);
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
              const projectId = await createProject({ name: name.trim() });
              onCreated(projectId);
              onClose();
            } catch (error) {
              setError(
                error instanceof ConvexError
                  ? String(error.data)
                  : "Couldn't create the project. Please try again.",
              );
            } finally {
              submitting.current = false;
              setPending(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
            <DialogDescription>Give your project a name.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="create-project-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              ref={input}
              id="create-project-name"
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
              {pending ? "Creating..." : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
