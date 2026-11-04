import { useEffect, useRef } from 'react'

// Opens a <dialog> as a modal when the component appears (the page behind
// is dimmed, focus stays inside, Escape fires onCancel) and closes it when
// the component goes away.
export function useModalDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) {
      dialog.showModal()
    }
    return () => dialog?.close()
  }, [])

  return dialogRef
}
