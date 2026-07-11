export const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  Vary: "Cookie, Authorization",
} as const

function applyNoStoreHeaders(response: Response): Response {
  for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
    response.headers.set(name, value)
  }
  return response
}

export function withNoStore(response: Response): Response {
  try {
    return applyNoStoreHeaders(response)
  } catch {
    return applyNoStoreHeaders(
      new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    )
  }
}
