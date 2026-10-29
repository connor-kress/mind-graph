import { ConvexError } from "convex/values";
import { useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import type { LibraryTarget } from "./LibraryTree";

type Props = {
  target: LibraryTarget;
  onClose: () => void;
  onConfirm: (confirmation: string) => Promise<void>;
};

export function DeleteLibraryDialog({ target, onClose, onConfirm }: Props) {
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const folder = target.kind === "folder";
  const allowed = !folder || confirmation === target.name;
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting.current) onClose();
      }}
    >
      <AlertDialogContent
        onEscapeKeyDown={(e) => {
          if (submitting.current) e.preventDefault();
        }}
      >
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!allowed || submitting.current) return;
            submitting.current = true;
            setPending(true);
            setError(null);
            try {
              await onConfirm(confirmation);
              onClose();
            } catch (e) {
              setError(
                e instanceof ConvexError
                  ? String(e.data)
                  : `Couldn't delete the ${target.kind}. Please try again.`,
              );
            } finally {
              submitting.current = false;
              setPending(false);
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {target.kind}?</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {folder ? (
                <>
                  “{target.name}” and all maps, notes, and recall attempts inside it will be
                  permanently deleted.
                </>
              ) : (
                <>
                  “{target.name}”, its notes, and all recall attempts will be permanently deleted.
                </>
              )}{" "}
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {folder && (
            <div className="space-y-2">
              <label htmlFor="delete-folder-name" className="block text-sm break-words">
                Type <span className="font-semibold">{target.name}</span> to confirm.
              </label>
              <Input
                id="delete-folder-name"
                autoComplete="off"
                value={confirmation}
                disabled={pending}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>
              Cancel
            </AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={!allowed || pending}>
              {pending ? "Deleting..." : `Delete ${target.kind}`}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
