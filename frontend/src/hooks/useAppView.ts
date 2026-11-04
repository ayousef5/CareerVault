// Which page is showing (see lib/appView.ts). Links simply point at
// "#/resumes" or "#/"; this hook follows the URL hash.
import { useEffect, useState } from 'react'
import { viewFromHash } from '../lib/appView'
import type { AppView } from '../lib/appView'

export function useAppView(): AppView {
  const [view, setView] = useState<AppView>(() => viewFromHash(window.location.hash))

  useEffect(() => {
    function handleHashChange() {
      setView(viewFromHash(window.location.hash))
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  return view
}
