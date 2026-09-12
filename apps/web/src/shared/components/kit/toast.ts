import { toast as sonner } from "sonner";

/**
 * Toast wiring.
 *
 * The app mounts exactly one `<Toaster />` (in `App.tsx`), and this is the only
 * way the kit talks to it. A second toast library — or a second calling
 * convention — is debt, not a pattern.
 *
 * What a toast is FOR, and what it is not: a toast confirms that something
 * happened somewhere the user is not looking. It is not an error surface. A
 * failed write that the user is staring at belongs in the form, next to the
 * field; a validation error belongs on the input; a compliance failure belongs
 * in a `RuleCheckRow`. A toast that carries the only copy of an error message
 * has thrown that message away after four seconds.
 *
 * The centralised `MutationCache` in `shared/api/queryClient.ts` is the intended
 * caller for failed writes. Screens call `toast.success` after an action the
 * user triggered and then navigated away from.
 */

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export const toast = {
  /** Something the user asked for finished. */
  success(message: string, options?: { description?: string; action?: ToastAction }) {
    return sonner.success(message, options);
  },

  /**
   * Something failed. `description` should carry the server's own sentence —
   * the contract's error envelope has one for every code, and it is better than
   * anything the frontend can compose.
   */
  error(message: string, options?: { description?: string; action?: ToastAction }) {
    return sonner.error(message, options);
  },

  /** A neutral fact. Use sparingly: most facts belong on the page. */
  info(message: string, options?: { description?: string; action?: ToastAction }) {
    return sonner(message, options);
  },

  /**
   * A write is in flight; resolve it when the promise settles. Prefer this to a
   * spinner for an action the user has already navigated away from.
   */
  promise<T>(
    promise: Promise<T>,
    messages: { loading: string; success: string | ((value: T) => string); error: string },
  ) {
    return sonner.promise(promise, messages);
  },

  dismiss(id?: string | number) {
    return sonner.dismiss(id);
  },
};
