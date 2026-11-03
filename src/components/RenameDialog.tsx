import { ConvexError } from "convex/values";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

type Props = {
  /** E.g. "Rename map". */
  heading: string;
  description: string;
  /** The field's label, e.g. "Name". */
  label: string;
  /** E.g. "Save name". */
  saveLabel: string;
  initialValue: string;
  maxLength: number;
  /** Saves the trimmed value. A ConvexError's message is shown to the user. */
  onSave: (value: string) => Promise<void>;
  onClose: () => void;
  /** Where focus goes when the dialog closes, e.g. the menu button it was opened from. */
  returnFocus?: () => HTMLElement | null | undefined;
};

/** A dialog that renames something. Render it only while renaming, so each opens fresh. */
export function RenameDialog({
  heading,
  description,
  label,
  saveLabel,
  initialValue,
  maxLength,
  onSave,
  onClose,
  returnFocus,
}: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Focus is taken once the menu that opened the dialog has returned focus to its
  // trigger, which happens just after the dialog opens.
  const focusFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!saving}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          focusFrame.current = requestAnimationFrame(() => {
            input.current?.focus();
            // Only now: selecting on every focus would replace an edit after tabbing back.
            input.current?.select();
          });
        }}
        onCloseAutoFocus={(e) => {
          const target = returnFocus?.();
          if (!target?.isConnected) return;
          e.preventDefault();
          target.focus();
        }}
      >
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const trimmed = value.trim();
            if (saving || !trimmed) return;
            setSaving(true);
            setError(null);
            try {
              await onSave(trimmed);
              onClose();
            } catch (error) {
              // Back to the field once it's enabled again, keeping the edit as typed.
              focusFrame.current = requestAnimationFrame(() => input.current?.focus());
              setError(
                error instanceof ConvexError
                  ? String(error.data)
                  : "Couldn't save. Check your connection and try again.",
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{heading}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor={id} className="text-sm font-medium">
              {label}
            </label>
            <Input
              ref={input}
              id={id}
              maxLength={maxLength}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={saving}
              aria-invalid={!!error}
              aria-describedby={error ? errorId : undefined}
            />
            {error && (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !value.trim()}>
              {saving ? "Saving..." : saveLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
