// Whether the user is logged in, and the single way to end a session when
// the API says the login has expired.
import { useCallback, useState } from 'react'
import { getToken, logout } from '../api/authApi'

export function useSession() {
  // Logged in if a token is already stored (e.g. after a page refresh).
  const [isAuthenticated, setIsAuthenticated] = useState(() => getToken() !== null)

  // AuthScreen calls this after a successful login.
  const logIn = useCallback(() => setIsAuthenticated(true), [])

  // Called whenever a request gets 401: forget the token and show the login
  // screen. Unsaved work stays in memory and is recovered after logging in.
  const expireSession = useCallback(() => {
    logout()
    setIsAuthenticated(false)
  }, [])

  return { isAuthenticated, logIn, expireSession }
}
