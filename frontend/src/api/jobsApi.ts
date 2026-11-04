// Requests for the logged-in user's job applications (/api/jobs).
import type { JobRequestBody } from '../lib/jobRows.ts'
import type { JobApplication } from '../types/job.ts'
import { apiRequest } from './apiClient.ts'

const JOBS_PATH = '/api/jobs'

// The JSON body the backend expects (its CreateJobRequest). The whole job
// is sent every time, not just the field that changed. The resume is never
// part of it: it's uploaded and removed with uploadJobResume /
// removeJobResume, so an autosave can never change it.
export function toRequestBody(job: JobApplication): JobRequestBody {
  return {
    companyName: job.companyName,
    jobTitle: job.jobTitle,
    location: job.location,
    jobUrl: job.jobUrl,
    dateApplied: job.dateApplied,
    status: job.status,
    notes: job.notes,
    jobDescription: job.jobDescription,
    pay: job.pay,
    recruiter: job.recruiter,
  }
}

// All of the user's jobs, in the order they were added.
export function fetchJobs(token: string | null) {
  return apiRequest<JobApplication[]>(JOBS_PATH, { token, readJson: true })
}

// Creates a job; the response includes its new database id.
export function createJob(body: JobRequestBody, token: string | null) {
  return apiRequest<JobApplication>(JOBS_PATH, { method: 'POST', token, body, readJson: true })
}

// Replaces a job's fields.
export function updateJob(id: number, body: JobRequestBody, token: string | null) {
  return apiRequest(`${JOBS_PATH}/${id}`, { method: 'PUT', token, body })
}

// Uploads a PDF or Word file to a job and attaches it, replacing any resume
// it had. Returns the updated job (with its new resume).
export function uploadJobResume(id: number, file: File, token: string | null) {
  const form = new FormData()
  form.append('file', file)
  return apiRequest<JobApplication>(`${JOBS_PATH}/${id}/resume`, { method: 'PUT', token, body: form, readJson: true })
}

// Removes a job's resume. Returns the updated job (with no resume).
export function removeJobResume(id: number, token: string | null) {
  return apiRequest<JobApplication>(`${JOBS_PATH}/${id}/resume`, { method: 'DELETE', token, readJson: true })
}

// Deletes a job. 404 means it's already gone.
export function deleteJob(id: number, token: string | null) {
  return apiRequest(`${JOBS_PATH}/${id}`, { method: 'DELETE', token })
}
