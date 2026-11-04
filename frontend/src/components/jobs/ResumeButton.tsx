import type { AttachedResume } from '../../types/resume'

// The Resume cell: shows the attached file's name, or "+ Upload" when
// there's none. Clicking it, or pressing Space or F2 while it's selected,
// opens the Resume dialog.
type ResumeButtonProps = {
  resume: AttachedResume | null
  tabIndex: number
  onOpen: () => void
}

function ResumeButton({ resume, tabIndex, onOpen }: ResumeButtonProps) {
  return (
    // data-focus-target lets the grid move keyboard focus onto this cell.
    <button
      type="button"
      className={resume ? 'description-cell' : 'description-cell empty'}
      tabIndex={tabIndex}
      data-focus-target
      title={resume ? resume.originalFileName : 'No resume attached'}
      aria-label={resume ? `Resume: ${resume.originalFileName}` : 'Upload a resume'}
      onClick={onOpen}
    >
      {resume ? resume.originalFileName : '+ Upload'}
    </button>
  )
}

export default ResumeButton
