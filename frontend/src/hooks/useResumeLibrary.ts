// The Resume Library's data: the user's resume files, one entry per unique
// file, each with the applications using it. Loaded from the server each
// time the page opens, so it always reflects the latest uploads,
// replacements and removals. A 401 ends the session like everywhere else.
import { useEffect, useEffectEvent, useState } from 'react'
import { getToken } from '../api/authApi'
import { fetchResumeLibrary } from '../api/resumesApi'
import { parseLibraryFiles } from '../lib/jobResume'
import { requestErrorMessage } from '../lib/resumeFiles'
import type { LibraryFile } from '../types/resume'

type UseResumeLibraryOptions = {
  // Ends the session (and shows the login screen) after a 401.
  onSessionExpired: () => void
}

export function useResumeLibrary({ onSessionExpired }: UseResumeLibraryOptions) {
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Lets the loading effect call the latest onSessionExpired without
  // re-running when the parent re-renders.
  const expireSession = useEffectEvent(() => onSessionExpired())

  useEffect(() => {
    let ignore = false

    async function load() {
      const result = await fetchResumeLibrary(getToken())
      if (ignore) {
        return
      }

      if (result.ok) {
        setFiles(parseLibraryFiles(result.data))
      } else if (result.status === 401) {
        expireSession()
      } else {
        setLoadError(requestErrorMessage(result.status, result.message, 'load your resumes'))
      }
      setIsLoading(false)
    }

    void load()
    return () => {
      ignore = true
    }
  }, [])

  return { files, isLoading, loadError }
}
