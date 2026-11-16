import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError } from './api';

/** Maps server validation details onto form fields; falls back to a toast for everything else. */
export function handleApiError<T extends FieldValues>(err: unknown, setError?: UseFormSetError<T>): void {
  if (err instanceof ApiError) {
    if (err.details && setError) {
      let mapped = false;
      for (const d of err.details) {
        if (d.path) { setError(d.path as Path<T>, { message: d.message }); mapped = true; }
      }
      if (mapped) return;
    }
    toast.error(err.message);
    return;
  }
  toast.error('Something went wrong. Please try again.');
}
