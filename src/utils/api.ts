/**
 * Safe API Client for Mana AI
 * Guarantees zero "Unexpected token '<', <DOCTYPE..." errors across the entire app.
 * Automatically manages Authorization tokens, guest session isolation, and structured errors.
 */

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  status: number
}

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem('mana_auth_token')
  } catch {
    return null
  }
}

export function getOrCreateGuestId(): string {
  try {
    let guestId = localStorage.getItem('mana_guest_id')
    if (!guestId) {
      guestId = 'guest_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8)
      localStorage.setItem('mana_guest_id', guestId)
    }
    return guestId
  } catch {
    return 'guest_default'
  }
}

export async function safeApiFetch<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const token = getAuthToken()
    const guestId = getOrCreateGuestId()

    // Build headers cleanly
    const headers = new Headers(options.headers || {})
    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json')
    }
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    if (!headers.has('x-guest-id')) {
      headers.set('x-guest-id', guestId)
    }

    const res = await fetch(endpoint, {
      ...options,
      headers,
    })

    const contentType = res.headers.get('content-type') || ''
    let parsedBody: any = null

    if (contentType.includes('application/json')) {
      try {
        parsedBody = await res.json()
      } catch (jsonErr) {
        parsedBody = null
      }
    } else {
      // If server returned HTML, text, or empty response:
      const rawText = await res.text()
      if (rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) {
        try {
          parsedBody = JSON.parse(rawText)
        } catch {
          parsedBody = null
        }
      }
    }

    // Determine error message safely
    if (!res.ok) {
      let message = 'An error occurred while communicating with the server.'
      if (parsedBody && typeof parsedBody === 'object') {
        message = parsedBody.error?.message || parsedBody.error || parsedBody.message || message
      } else if (res.status === 404) {
        message = 'The requested resource or API endpoint was not found (HTTP 404).'
      } else if (res.status === 401) {
        message = 'Invalid email or password. Please check your credentials.'
      } else if (res.status === 403) {
        message = 'Access denied. You do not have permission for this action.'
      } else if (res.status === 502 || res.status === 503 || res.status === 504) {
        message = 'Backend service is temporarily waking up or updating. Please retry in a few seconds.'
      }

      return {
        success: false,
        error: message,
        status: res.status,
      }
    }

    // Check application-level failure payload (e.g. { success: false, error: "..." })
    if (parsedBody && typeof parsedBody === 'object') {
      if (parsedBody.success === false) {
        return {
          success: false,
          error: parsedBody.error?.message || parsedBody.error || 'Operation failed.',
          status: res.status,
          data: parsedBody.data,
        }
      }
      return {
        success: true,
        data: parsedBody.data !== undefined ? parsedBody.data : (parsedBody as T),
        status: res.status,
      }
    }

    return {
      success: true,
      data: parsedBody as T,
      status: res.status,
    }
  } catch (netErr: any) {
    return {
      success: false,
      error: netErr.message || 'Network connection error. Please check your internet connection.',
      status: 0,
    }
  }
}
