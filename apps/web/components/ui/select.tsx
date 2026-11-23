'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import {
  Children,
  forwardRef,
  isValidElement,
  useEffect,
  useState,
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

const EMPTY_SENTINEL = '__EMPTY_VAL__';

interface ParsedOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

function extractOptions(children: ReactNode): ParsedOption[] {
  const options: ParsedOption[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type === 'option') {
      const childProps = child.props as { value?: string | number; disabled?: boolean; children?: ReactNode };
      const val = childProps.value !== undefined ? String(childProps.value) : '';
      options.push({
        value: val,
        label: childProps.children ?? val,
        disabled: childProps.disabled,
      });
    }
  });
  return options;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  placeholder?: string;
  children?: ReactNode;
}

/**
 * Universal accessible Select component.
 * Supports:
 * 1. Traditional `<option>` children for effortless backward compatibility:
 *    `<Select value={val} onChange={e => set(e.target.value)}><option value="">All</option></Select>`
 * 2. Composable Radix Select primitives (`SelectTrigger`, `SelectContent`, `SelectItem`, etc.)
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, value, defaultValue, onChange, placeholder, disabled, ...props },
  _ref
) {
  // Check if children are `<option>` elements
  const options = extractOptions(children);
  const isOptionBased = options.length > 0;

  // Uncontrolled vs Controlled state
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState<string>(() => {
    if (value !== undefined) return String(value);
    if (defaultValue !== undefined) return String(defaultValue);
    return '';
  });

  useEffect(() => {
    if (value !== undefined) {
      setInternalValue(String(value));
    }
  }, [value]);

  const activeValue = isControlled ? String(value) : internalValue;

  // If composable Radix primitives are used directly (no `<option>` children)
  if (!isOptionBased) {
    return (
      <SelectPrimitive.Root
        value={activeValue}
        defaultValue={defaultValue !== undefined ? String(defaultValue) : undefined}
        onValueChange={(val) => {
          if (!isControlled) setInternalValue(val);
          onChange?.({
            target: { value: val, name: props.name },
            currentTarget: { value: val, name: props.name },
          } as unknown as ChangeEvent<HTMLSelectElement>);
        }}
        disabled={disabled}
      >
        {children}
      </SelectPrimitive.Root>
    );
  }

  // Option-based Radix wrapper
  const radixValue = activeValue === '' ? EMPTY_SENTINEL : activeValue;

  const handleValueChange = (val: string) => {
    const realVal = val === EMPTY_SENTINEL ? '' : val;
    if (!isControlled) {
      setInternalValue(realVal);
    }
    onChange?.({
      target: { value: realVal, name: props.name },
      currentTarget: { value: realVal, name: props.name },
    } as unknown as ChangeEvent<HTMLSelectElement>);
  };

  const selectedOption = options.find((o) => o.value === activeValue);

  return (
    <SelectPrimitive.Root
      value={radixValue}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-md border border-input bg-surface px-3 py-2 text-base lg:h-9 lg:text-[13px] text-foreground shadow-sm transition-colors hover:border-border-strong focus:outline-none focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger',
          className
        )}
        aria-label={props['aria-label']}
      >
        <span className="truncate">
          {selectedOption ? (
            selectedOption.label
          ) : (
            <SelectPrimitive.Value placeholder={placeholder ?? 'Select an option…'} />
          )}
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground opacity-70 ml-2" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={5}
          className="z-50 max-h-80 min-w-32 overflow-hidden rounded-md border border-border bg-card text-foreground shadow-lg"
        >
          <SelectPrimitive.ScrollUpButton className="flex items-center justify-center py-1 text-muted-foreground">
            <ChevronUp className="h-4 w-4" />
          </SelectPrimitive.ScrollUpButton>

          <SelectPrimitive.Viewport className="p-1">
            {options.map((opt) => {
              const itemVal = opt.value === '' ? EMPTY_SENTINEL : opt.value;
              return (
                <SelectPrimitive.Item
                  key={opt.value}
                  value={itemVal}
                  disabled={opt.disabled}
                  className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2.5 pr-8 text-[13px] outline-none transition-colors data-[highlighted]:bg-muted data-[highlighted]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                >
                  <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center justify-center">
                    <Check className="h-4 w-4 text-primary stroke-[2.5]" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              );
            })}
          </SelectPrimitive.Viewport>

          <SelectPrimitive.ScrollDownButton className="flex items-center justify-center py-1 text-muted-foreground">
            <ChevronDown className="h-4 w-4" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
});

// Composable Radix Select Primitives for custom layouts
export const SelectRoot = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      'flex h-10 w-full items-center justify-between rounded-md border border-input bg-surface px-3 py-2 text-base lg:h-9 lg:text-[13px] text-foreground shadow-sm transition-colors hover:border-border-strong focus:outline-none focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger',
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground opacity-70 ml-2" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export const SelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      sideOffset={5}
      className={cn(
        'z-50 max-h-80 min-w-32 overflow-hidden rounded-md border border-border bg-card text-foreground shadow-lg',
        position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
        className
      )}
      {...props}
    >
      <SelectPrimitive.ScrollUpButton className="flex items-center justify-center py-1 text-muted-foreground">
        <ChevronUp className="h-4 w-4" />
      </SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="flex items-center justify-center py-1 text-muted-foreground">
        <ChevronDown className="h-4 w-4" />
      </SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

export const SelectLabel = forwardRef<
  ElementRef<typeof SelectPrimitive.Label>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground tracking-wider uppercase', className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

export const SelectItem = forwardRef<
  ElementRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2.5 pr-8 text-[13px] outline-none transition-colors data-[highlighted]:bg-muted data-[highlighted]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center justify-center">
      <Check className="h-4 w-4 text-primary stroke-[2.5]" />
    </SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export const SelectSeparator = forwardRef<
  ElementRef<typeof SelectPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-border', className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;
