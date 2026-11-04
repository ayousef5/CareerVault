import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { describeLength } from '../../lib/jobDisplay'

// The Job Description cell: shows how long the saved description is
// ("1,240 words"), or "+ Add" when there isn't one. Clicking it, or pressing
// Space or F2 while it's selected, opens the editor.
type DescriptionButtonProps = {
  description: string | null
  tabIndex: number
  onOpen: () => void
  id?: string
  // Used by the Add Job row for its own arrow-key handling.
  onKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
}

function DescriptionButton({ description, tabIndex, onOpen, id, onKeyDown }: DescriptionButtonProps) {
  const text = description ?? ''
  const hasDescription = text.trim() !== ''

  return (
    // data-focus-target lets the grid move keyboard focus onto this cell.
    <button
      type="button"
      id={id}
      className={hasDescription ? 'description-cell' : 'description-cell empty'}
      tabIndex={tabIndex}
      data-focus-target
      aria-label={hasDescription ? `Job description, ${describeLength(text)}` : 'Add job description'}
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      {hasDescription ? describeLength(text) : '+ Add'}
    </button>
  )
}

export default DescriptionButton
