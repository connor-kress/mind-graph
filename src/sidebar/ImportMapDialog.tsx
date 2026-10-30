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
import type { MapFileChoice } from "./readMapFile";

type Props = {
  projectId: Id<"projects">;
  projectName?: string;
  choice: MapFileChoice;
  onChooseAgain: () => void;
  onClose: () => void;
  onImported: (id: Id<"topics">) => void;
};

export function ImportMapDialog({
  projectId,
  projectName,
  choice,
  onChooseAgain,
  onClose,
  onImported,
}: Props) {
  const importMap = useMutation(api.library.importMap);
  const [name, setName] = useState("title" in choice ? choice.title.trim().slice(0, 200) : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const problem = "problem" in choice ? choice.problem : null;
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
            if (problem || !name.trim() || submitting.current) return;
            submitting.current = true;
            setPending(true);
            setError(null);
            try {
              const topicId = await importMap({
                projectId,
                title: name.trim(),
                nodes: "nodes" in choice ? choice.nodes : [],
              });
              onImported(topicId);
              onClose();
            } catch (error) {
              setError(
                error instanceof ConvexError
                  ? String(error.data)
                  : "Couldn't import the map. Please try again.",
              );
            } finally {
              submitting.current = false;
              setPending(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Import map</DialogTitle>
            <DialogDescription className="break-all">
              {projectName ? `From ${choice.fileName} into ${projectName}` : choice.fileName}
            </DialogDescription>
          </DialogHeader>
          {problem ? (
            <p role="alert" className="text-sm text-destructive">
              {problem}. Choose a .json file exported from Mind Graph.
            </p>
          ) : (
            <div className="space-y-2">
              <label htmlFor="import-map-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                ref={input}
                id="import-map-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
                autoComplete="off"
                disabled={pending}
              />
              {"nodes" in choice && (
                <p className="text-xs text-muted-foreground">
                  {choice.nodes.length === 1 ? "1 node" : `${choice.nodes.length} nodes`}
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            {problem ? (
              <Button type="button" onClick={onChooseAgain}>
                Choose another file
              </Button>
            ) : (
              <Button type="submit" disabled={!name.trim() || pending}>
                {pending ? "Importing..." : "Import map"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
