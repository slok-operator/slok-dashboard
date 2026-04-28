import type { ListSLOsResponse, SLODetail, SLOTimeseriesResponse } from './types'

async function requestJSON<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    const fallback = `${response.status} ${response.statusText}`
    let message = fallback

    try {
      const payload = await response.json()
      message = payload?.error ?? fallback
    } catch {
      // ignore JSON parse errors and fall back to HTTP status
    }

    throw new Error(message)
  }

  return response.json() as Promise<T>
}

export function listSLOs() {
  return requestJSON<ListSLOsResponse>('/api/slos')
}

export function getSLO(namespace: string, name: string) {
  return requestJSON<SLODetail>(`/api/slos/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`)
}


export function getSLOTimeseries(namespace: string, name: string, range = '6h', step = '5m') {
  const params = new URLSearchParams({ range, step })
  return requestJSON<SLOTimeseriesResponse>(`/api/slos/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/timeseries?${params}`)
}
