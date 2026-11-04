// The row of summary cards above the grid (total, applied, interviewing, offers).
import type { JobApplication } from '../../types/job'

type SummaryCardProps = {
  label: string
  value: number
}

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <div className="summary-card">
      <p className="summary-label">{label}</p>
      <p className="summary-value">{value}</p>
    </div>
  )
}

// Counts the applications by status and shows one card per count.
function SummaryCards({ applications }: { applications: JobApplication[] }) {
  const count = (status: string) =>
    applications.filter((application) => application.status === status).length

  return (
    <section className="summary-grid">
      <SummaryCard label="Total Applications" value={applications.length} />
      <SummaryCard label="Applied" value={count('Applied')} />
      <SummaryCard label="Interviewing" value={count('Interviewing')} />
      <SummaryCard label="Offers" value={count('Offer')} />
    </section>
  )
}

export default SummaryCards
