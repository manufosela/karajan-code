import clsx from "clsx";

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

interface CardHeaderProps {
  children: React.ReactNode;
  className?: string;
}

interface CardBodyProps {
  children: React.ReactNode;
  className?: string;
}

interface CardFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <div
      className={clsx(
        "rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: CardHeaderProps) {
  return (
    <div
      className={clsx(
        "border-b border-[var(--border-primary)] px-6 py-4",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardBody({ children, className }: CardBodyProps) {
  return <div className={clsx("px-6 py-4", className)}>{children}</div>;
}

export function CardFooter({ children, className }: CardFooterProps) {
  return (
    <div
      className={clsx(
        "border-t border-[var(--border-primary)] px-6 py-4",
        className
      )}
    >
      {children}
    </div>
  );
}
