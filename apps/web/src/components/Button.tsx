import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

type ButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary";
  }
>;

export function Button({ children, className = "", variant = "secondary", ...props }: ButtonProps) {
  return (
    <button className={`button button-${variant} ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  );
}
