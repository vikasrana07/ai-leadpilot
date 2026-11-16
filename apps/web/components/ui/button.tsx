'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { motion, useReducedMotion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover',
        secondary: 'border border-border bg-surface text-foreground shadow-sm hover:bg-muted',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        danger: 'bg-danger text-danger-foreground shadow-sm hover:opacity-90',
        link: 'h-auto px-0 text-primary underline underline-offset-2 hover:no-underline',
      },
      /* Touch devices get 40px targets (sm 36px); desktop keeps the denser sizes. */
      size: { sm: 'h-9 px-3 lg:h-8', md: 'h-10 px-4 lg:h-9', lg: 'h-11 px-5 text-sm lg:h-10', icon: 'h-10 w-10 lg:h-9 lg:w-9' },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild, loading, disabled, children, ...props }, ref,
) {
  const reduce = useReducedMotion();
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) return <Slot ref={ref} className={classes} {...props}>{children}</Slot>;
  return (
    <motion.button
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      whileTap={reduce || disabled || loading ? undefined : { scale: 0.97 }}
      transition={{ duration: 0.08 }}
      {...(props as object)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </motion.button>
  );
});

export { buttonVariants };
