// The left-hand navigation with the CareerVault logo.
import { hashForView } from '../../lib/appView'
import type { AppView } from '../../lib/appView'

// The pages the sidebar links to. "Settings" doesn't exist yet; it's kept
// as a placeholder.
const navLinks: { label: string; view: AppView | null }[] = [
  { label: 'Dashboard', view: 'dashboard' },
  { label: 'My Applications', view: 'applications' },
  { label: 'Resume Library', view: 'resumes' },
  { label: 'Settings', view: null },
]

type SidebarProps = {
  // The page that's showing, so its link is highlighted.
  activeView: AppView
}

function Sidebar({ activeView }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="logo">
        <span className="logo-mark">CV</span>
        <span className="logo-text">CareerVault</span>
      </div>

      <nav className="nav" aria-label="Main">
        {navLinks.map((link) => {
          const isActive = link.view === activeView
          return (
            <a
              key={link.label}
              // Changing the URL hash switches the page (see useAppView).
              href={link.view ? hashForView(link.view) : '#'}
              className={isActive ? 'nav-link active' : 'nav-link'}
              aria-current={isActive ? 'page' : undefined}
            >
              {link.label}
            </a>
          )
        })}
      </nav>
    </aside>
  )
}

export default Sidebar
