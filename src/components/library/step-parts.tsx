import { ArrowLeft } from "lucide-react";

/** Top of a step: an optional Back, the step count and the title. */
export function StepHeader({
  step,
  total,
  label,
  title,
  onBack,
  children,
}: {
  step?: number;
  total?: number;
  /** Shown instead of the step count, outside a numbered flow. */
  label?: string;
  title: string;
  onBack?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 mb-4 flex items-center gap-1.5 rounded-full py-1.5 pr-3 pl-2 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <ArrowLeft size={16} /> Back
        </button>
      )}
      <p className="text-sm font-medium tracking-wide text-muted uppercase">
        {label ?? `Step ${step}${total ? ` of ${total}` : ""}`}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance text-white">{title}</h1>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

/** The step's main action, kept at the bottom of the screen when the step runs longer than it. */
export function StickyAction({
  children,
  disabled,
  onClick,
  note,
  secondary,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  note?: React.ReactNode;
  /** A quieter second action under the main one. */
  secondary?: { label: React.ReactNode; onClick: () => void };
}) {
  return (
    <div className="sticky bottom-0 -mb-8 mt-auto bg-background pt-4 pb-8">
      {note && <p className="mb-3 text-center text-xs text-subtle">{note}</p>}
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="h-12 w-full rounded-full bg-primary text-base font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {children}
      </button>
      {secondary && (
        <button
          type="button"
          onClick={secondary.onClick}
          className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          {secondary.label}
        </button>
      )}
    </div>
  );
}

/** Slides a step in from the left. */
export const STEP_IN = "flex flex-1 flex-col gap-8 motion-safe:animate-[panel-in_220ms_ease-out]";
